const assert = require('assert');
const Module = require('module');

const originalRequire = Module.prototype.require;
Module.prototype.require = function (id) {
  if (id === 'vscode') {
    return {
      commands: { registerCommand: () => ({ dispose: () => {} }) },
      workspace: { onDidChangeTextDocument: () => ({ dispose: () => {} }) },
      window: {
        onDidChangeActiveTextEditor: () => ({ dispose: () => {} }),
        showWarningMessage: () => {},
        createWebviewPanel: () => ({ webview: {}, onDidDispose: () => {} })
      },
      ViewColumn: { Beside: 2 }
    };
  }
  return originalRequire.apply(this, arguments);
};

const { analyzeCode } = require('./extension');

function runTest(name, cppCode, checkFn) {
  try {
    const stats = analyzeCode(cppCode);
    checkFn(stats);
    console.log(`✅ [OK] ${name}`);
  } catch (err) {
    console.error(`❌ [FAIL] ${name}\n   ${err.message}`);
  }
}

runTest('Тест 1: Массив и очистка', `
int main() {
    int n = 10;
    int* arr = new int[n];
    delete[] arr;
    return 0;
}
`, s => {
  assert.strictEqual(s.functions, 1);
  assert.strictEqual(s.variables, 2);
  assert.strictEqual(s.memory, 12);
  assert.strictEqual(s.dynamicMemory, 40);
  assert.strictEqual(s.totalMemory, 52);
  assert.strictEqual(s.hasLeak, false);
});

runTest('Тест 2: Утечка памяти', `
void leak() {
    double* ptr = new double;
}
`, s => {
  assert.strictEqual(s.dynamicMemory, 8);
  assert.strictEqual(s.newCount, 1);
  assert.strictEqual(s.deleteCount, 0);
  assert.strictEqual(s.hasLeak, true);
});

runTest('Тест 3: malloc/free', `
void cMemory() {
    void* buf = malloc(64);
    free(buf);
}
`, s => {
  assert.strictEqual(s.dynamicMemory, 64);
  assert.strictEqual(s.mallocCount, 1);
  assert.strictEqual(s.freeCount, 1);
  assert.strictEqual(s.hasLeak, false);
});

runTest('Тест 4: Комментарии и строки', `
// int fake = 100; new int;
int main() {
    char* text = "/* fake */ if (true) for while";
    return 0;
}
`, s => {
  assert.strictEqual(s.commentLines, 1);
  assert.strictEqual(s.variables, 1);
  assert.strictEqual(s.ifs, 0);
  assert.strictEqual(s.loops, 0);
  assert.strictEqual(s.dynamicMemory, 0);
});

runTest('Тест 5: Незавершённый delete', `
int main() {
    int* p = new int;
    delete p
}
`, s => {
  assert.strictEqual(s.newCount, 1);
  assert.strictEqual(s.deleteCount, 0);
  assert.strictEqual(s.hasLeak, true);
});


