const vscode = require('vscode');

/**
 * Словарь базовых размеров примитивных типов данных C++ в байтах.
 * @type {Object<string, number>}
 */
const TYPE_SIZES = {
  char: 1, bool: 1, short: 2,
  int: 4, float: 4, long: 8, double: 8
};

/**
 * Выполняет статический анализ исходного кода на языке C++.
 * Очищает код от комментариев и строковых литералов, подсчитывает синтаксические
 * конструкции, оценивает объём статической и динамической памяти, а также
 * проверяет баланс операций выделения и освобождения памяти.
 *
 * @param {string} text Исходный текст C++ файла.
 * @returns {Object} Объект со статистикой по файлу и оценкой памяти.
 */
function analyzeCode(text) {
  const clean = text.replace(
    /"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|\/\*[\s\S]*?\*\/|\/\/[^\n]*/g,
    m => (m.startsWith('/') ? '' : '""')
  );

  const count = re => (clean.match(re) || []).length;

  const varsMap = {};
  const constRe = /\b(?:const\s+)?(?:char|short|int|long|float|double)\s+([A-Za-z_]\w*)\s*=\s*(\d+)\b/g;
  let m;

  while ((m = constRe.exec(clean)) !== null) {
    varsMap[m.at(1)] = Number(m.at(2));
  }

  let variables = 0;
  let memory = 0;

  const varRe = /\b(char|bool|short|int|float|long|double)\s*(\*)?\s*[A-Za-z_]\w*(?:\[(\d+)\])?\s*(?=[;=,])/g;

  while ((m = varRe.exec(clean)) !== null) {
    variables++;
    const size = m.at(2) ? 8 : TYPE_SIZES[m.at(1)];
    memory += size * Number(m.at(3) || 1);
  }

  let dynamicMemory = 0;

  const newRe = /\bnew\s+(char|bool|short|int|float|long|double)(?:\s*\[\s*(\d+|[A-Za-z_]\w*)\s*\])?/g;

  while ((m = newRe.exec(clean)) !== null) {
    const rawSize = m.at(2);
    const arrSize = rawSize
      ? (/^\d+$/.test(rawSize) ? Number(rawSize) : (varsMap[rawSize] || 0))
      : 1;

    dynamicMemory += TYPE_SIZES[m.at(1)] * arrSize;
  }

  const mallocRe = /\bmalloc\s*\(\s*(\d+)\s*\)/g;

  while ((m = mallocRe.exec(clean)) !== null) {
    dynamicMemory += Number(m.at(1));
  }

  const newCount = count(/\bnew\b/g);
  const deleteCount = count(/\bdelete(?:\s*\[\s*\])?\s+[A-Za-z_]\w*\s*;/g);
  const mallocCount = count(/\bmalloc\s*\(/g);
  const freeCount = count(/\bfree\s*\(\s*[A-Za-z_]\w*\s*\)/g);

  const rawLines = text.split('\n');
  const maxLineLength = rawLines.reduce((max, line) => Math.max(max, line.length), 0);

  return {
    lines: rawLines.length,
    commentLines: (text.match(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'|(\/\*[\s\S]*?\*\/|\/\/[^\n]*)/g) || [])
      .filter(m => m.startsWith('/'))
      .join('\n').split('\n').filter(Boolean).length,

    functions: count(/\b\w+\s+\w+\s*\([^;{}]*\)\s*\{/g),
    variables,
    ifs: count(/\bif\s*\(/g),
    loops: count(/\bfor\s*\(/g) + count(/\bwhile\s*\(/g),
    maxLineLength,
    newCount,
    deleteCount,
    mallocCount,
    freeCount,
    hasLeak: newCount > deleteCount || mallocCount > freeCount,
    memory,
    dynamicMemory,
    totalMemory: memory + dynamicMemory
  };
}

/**
 * Генерирует HTML-разметку для отображения статистики внутри панели Webview.
 *
 * @param {Object} s Объект со статистикой, возвращённый функцией analyzeCode.
 * @returns {string} Готовая HTML-страница со стилями темы VS Code.
 */
function createHtml(s) {
  const items = [
    ['Строк', s.lines],
    ['Комментариев', s.commentLines],
    ['Функций', s.functions],
    ['Переменных', s.variables],
    ['Условий if', s.ifs],
    ['Циклов', s.loops],
    ['Макс. строка', `${s.maxLineLength} симв.`]
  ];

  const leakStatus = s.newCount === 0 && s.mallocCount === 0
    ? '<span style="opacity: 0.7;">Динамическое выделение не используется</span>'
    : s.hasLeak
      ? `<span style="color: #f14c4c; font-weight: bold;">⚠️ Возможна утечка</span>`
      : `<span style="color: #4ec9b0; font-weight: bold;">✅ Количество операций выделения и освобождения совпадает</span>`;

  return `<!DOCTYPE html>
  <html lang="ru">
  <head>
    <meta charset="UTF-8">
    <style>
      body { font-family: sans-serif; padding: 16px; color: var(--vscode-foreground); }
      .grid { display: grid; grid-template-columns: repeat(auto-fit, minmax(120px, 1fr)); gap: 8px; margin: 16px 0; }
      .card { background: var(--vscode-editor-inactiveSelectionBackground); padding: 12px; border-radius: 6px; }
      .num { font-size: 20px; font-weight: bold; }
      .box { padding: 12px; border: 1px solid var(--vscode-panel-border); border-radius: 6px; line-height: 1.7; }
    </style>
  </head>
  <body>
    <h3>Code Statistics</h3>
    <div class="grid">
      ${items.map(([k, v]) => `<div class="card"><div class="num">${v}</div><div>${k}</div></div>`).join('')}
    </div>
    <div class="box">
      <div>Память: <b>${s.memory} байт</b></div>
      <div>Динамическая память: <b>${s.dynamicMemory} байт</b></div>
      <div>new: ${s.newCount}, delete: ${s.deleteCount}</div>
      <div>malloc: ${s.mallocCount}, free: ${s.freeCount}</div>
      <div>Статус: ${leakStatus}</div>
      <div style="margin-top: 6px; border-top: 1px solid var(--vscode-panel-border); padding-top: 6px;">
        Всего: <b>${s.totalMemory} байт</b>
      </div>
    </div>
  </body>
  </html>`;
}

/**
 * Точка входа расширения. Регистрирует команду запуска анализатора и
 * настраивает подписки на события изменения текста и смены активного редактора.
 *
 * @param {vscode.ExtensionContext} context Контекст жизненного цикла расширения VS Code.
 */
function activate(context) {
  let panel;

  const update = doc => {
    if (!panel) return;

    if (!doc || doc.languageId !== 'cpp') {
      panel.webview.html = `
        <html>
          <body style="font-family: sans-serif; padding: 16px; color: var(--vscode-foreground);">
            <h3>Code Statistics</h3>
            <p>Откройте файл C++</p>
          </body>
        </html>
      `;
      return;
    }

    panel.webview.html = createHtml(analyzeCode(doc.getText()));
  };

  context.subscriptions.push(
    vscode.commands.registerCommand('codeStatistics.analyze', () => {
      const editor = vscode.window.activeTextEditor;

      if (!editor || editor.document.languageId !== 'cpp') {
        return vscode.window.showWarningMessage('Откройте файл C++');
      }

      if (!panel) {
        panel = vscode.window.createWebviewPanel(
          'codeStatistics',
          'Code Statistics',
          vscode.ViewColumn.Beside,
          {}
        );

        panel.onDidDispose(() => {
          panel = undefined;
        });
      }

      update(editor.document);
    }),

    vscode.workspace.onDidChangeTextDocument(e => {
      if (e.document === vscode.window.activeTextEditor?.document) {
        update(e.document);
      }
    }),

    vscode.window.onDidChangeActiveTextEditor(e => {
      if (panel && e) update(e.document);
    })
  );
}

/**
 * Вызывается при деактивации расширения.
 */
function deactivate() {}

module.exports = { activate, deactivate, analyzeCode };
