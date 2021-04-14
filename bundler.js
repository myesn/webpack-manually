const fs = require('fs')
const path = require('path')
const babylon = require('@babel/parser')
const traverse = require('@babel/traverse').default
const babel = require('@babel/core')

let ID = 0

// 读取文件信息，并获得当前js文件的依赖关系
function createAsset(filename) {
  const content = fs.readFileSync(filename, 'utf-8')

  // babylon 负责解析字符串并生产 AST(抽象语法树 Abstract Syntax Tree)
  const ast = babylon.parse(content, {
    sourceType: 'module',
  })

  // 当前 js 文件 import 了哪些文件
  const dependencies = []

  // 遍历当前 AST
  traverse(ast, {
    // 找到有 import 语法的对应节点
    ImportDeclaration: ({ node }) => {
      // import message from './message.js'
      // './message.js' === node.source.value
      dependencies.push(node.source.value)
    },
  })

  // 模块的 id 从 0 开始，相当于一个 js 文件可以看成一个 module
  const id = ID++

  // ES6 to ES5
  const { code } = babel.transformFromAstSync(ast, null, {
    presets: ['@babel/preset-env'],
  })

  return {
    id,
    filename,
    dependencies,
    code,
  }
}

// 从入口开始分析所有依赖项，形成依赖图，采用广度遍历
function createGraph(entry) {
  const mainAsset = createAsset(entry)

  // 广度遍历的队列，第一个元素就是 entry 的信息
  const queue = [mainAsset]

  for (const asset of queue) {
    const dirname = path.dirname(asset.filename)

    // 保存子依赖项
    asset.mapping = {}
    asset.dependencies.forEach((relativePath) => {
      const absolutePath = path.join(dirname, relativePath)
      const child = createAsset(absolutePath)

      asset.mapping[relativePath] = child.id

      // 将子依赖项加入队列，广度遍历
      queue.push(child)
    })
  }

  return queue
}

// 根据生成的依赖关系图，生成浏览器可执行文件
function bundle(graph) {
  let modules = ''

  // 遍历依赖关系，将每个模块中的代码保存在 function 作用域里
  graph.forEach((mod) => {
    modules += `${mod.id}:[
      function(require, module, exports){
        ${mod.code}
      },
      ${JSON.stringify(mod.mapping)},
    ],`
  })

  // require、module、exports 是 cjs 的标准，不能在浏览器中直接使用
  // 模拟 cjs 模块加载、执行、导出
  const result = `
    (function(modules){
      function require(id){
        const [fn, mapping] = modules[id];
        const localRequire = function(relativePath){ 
          // 根据模块的路径在 mapping 中找到对应模块的 id
          return require(mapping[relativePath]);
        };
        const module = { exports: {} };

        // 执行每个模块的代码
        fn(localRequire, module, module.exports);
        
        return module.exports;
      }

      // 执行入口文件
      require(0);
    })({${modules}})
  `

  return result
}

const entryFile = './example/entry.js'
const graph = createGraph(entryFile)
const ret = bundle(graph)

// 打包生成文件
fs.writeFileSync('./dist/bundle.js', ret)
