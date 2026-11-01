"""Translate the pinned Metaphone 0.6 decision rules to JS (development only).

The generic npm implementation differs, including on 'magician' and numeric
names. Preserve Python's precise behavior, including its unknown-character
handling. Generated output has no Python/browser runtime dependency.
"""
import ast
import json
from pathlib import Path
import metaphone.metaphone as source


def expr(n):
    if isinstance(n, ast.Constant):
        return json.dumps(n.value)
    if isinstance(n, ast.Name):
        return 'this' if n.id == 'self' else n.id
    if isinstance(n, ast.Attribute):
        return expr(n.value) + '.' + n.attr
    if isinstance(n, (ast.List, ast.Tuple)):
        return '[' + ', '.join(expr(x) for x in n.elts) + ']'
    if isinstance(n, ast.Subscript):
        if isinstance(n.slice, ast.Slice):
            return expr(n.value) + '.slice(' + expr(n.slice.lower) + ', ' + expr(n.slice.upper) + ')'
        return expr(n.value) + '[' + expr(n.slice) + ']'
    if isinstance(n, ast.BinOp):
        if isinstance(n.right, ast.Tuple):
            return expr(n.left) + '.concat(' + expr(n.right) + ')'
        return '(' + expr(n.left) + (' + ' if isinstance(n.op, ast.Add) else ' - ') + expr(n.right) + ')'
    if isinstance(n, ast.BoolOp):
        return '(' + (' && ' if isinstance(n.op, ast.And) else ' || ').join(expr(x) for x in n.values) + ')'
    if isinstance(n, ast.UnaryOp):
        return ('!' if isinstance(n.op, ast.Not) else '-') + '(' + expr(n.operand) + ')'
    if isinstance(n, ast.Compare):
        assert len(n.ops) == 1
        a, b, op = expr(n.left), expr(n.comparators[0]), n.ops[0]
        if isinstance(op, (ast.In, ast.NotIn)):
            return ('!' if isinstance(op, ast.NotIn) else '') + b + '.includes(' + a + ')'
        operators = {ast.Eq: '===', ast.NotEq: '!==', ast.Gt: '>', ast.Lt: '<', ast.GtE: '>=', ast.LtE: '<='}
        return a + ' ' + operators[type(op)] + ' ' + b
    if isinstance(n, ast.Call):
        if isinstance(n.func, ast.Name) and n.func.id == 'len':
            return expr(n.args[0]) + '.length'
        if isinstance(n.func, ast.Name) and n.func.id == 'Word':
            return 'new Word(' + expr(n.args[0]) + ')'
        return expr(n.func) + '(' + ', '.join(expr(x) for x in n.args) + ')'
    raise TypeError(ast.dump(n))


def statements(nodes, depth):
    lines = []
    pad = '  ' * depth
    for n in nodes:
        if isinstance(n, ast.Expr):
            if isinstance(n.value, ast.Constant):
                continue  # Docstring.
            lines.append(pad + expr(n.value) + ';')
        elif isinstance(n, ast.Assign):
            lines.append(pad + ' = '.join([*(expr(t) for t in n.targets), expr(n.value)]) + ';')
        elif isinstance(n, ast.AugAssign):
            assert isinstance(n.op, ast.Add)
            lines.append(pad + expr(n.target) + ' += ' + expr(n.value) + ';')
        elif isinstance(n, ast.If):
            lines.append(pad + 'if (' + expr(n.test) + ') {')
            lines.extend(statements(n.body, depth + 1))
            if n.orelse:
                lines.append(pad + '} else {')
                lines.extend(statements(n.orelse, depth + 1))
            lines.append(pad + '}')
        elif isinstance(n, ast.While):
            lines.append(pad + 'while (' + expr(n.test) + ') {')
            lines.extend(statements(n.body, depth + 1))
            lines.append(pad + '}')
        elif isinstance(n, ast.Continue):
            lines.append(pad + 'continue;')
        elif isinstance(n, ast.Return):
            lines.append(pad + 'return ' + expr(n.value) + ';')
        else:
            raise TypeError(ast.dump(n))
    return lines


root = Path(__file__).parent
tree = ast.parse(Path(source.__file__).read_text())
header = '''// Generated from Metaphone 0.6 by generate-phonetics.py. See METAPHONE-LICENSE.
// Only called with clean()'s ASCII input; retain Python's decision rules exactly.
class Word {
  constructor(input) {
    const upper = input.toUpperCase();
    this.start_index = 2;
    this.end_index = upper.length + 1;
    this.buffer = '--' + upper + '------';
    this.is_slavo_germanic = /W|K|CZ|WITZ/.test(upper);
  }
  get_letters(start = 0, end = start + 1) {
    return this.buffer.slice(this.start_index + start, this.start_index + end);
  }
}
const VOWELS = ['A', 'E', 'I', 'O', 'U', 'Y'];
const SILENT_STARTERS = ['GN', 'KN', 'PN', 'WR', 'PS'];
class DoubleMetaphone {'''
lines = [header]
cls = next(n for n in tree.body if isinstance(n, ast.ClassDef))
for method in cls.body:
    if not isinstance(method, ast.FunctionDef):
        continue
    args = [a.arg for a in method.args.args if a.arg != 'self']
    name = 'constructor' if method.name == '__init__' else method.name
    lines.append('  ' + name + '(' + ', '.join(args) + ') {')
    locals_ = sorted({n.id for n in ast.walk(method) if isinstance(n, ast.Name) and isinstance(n.ctx, ast.Store)} - set(args))
    if locals_:
        lines.append('    let ' + ', '.join(locals_) + ';')
    lines.extend(statements(method.body, 2))
    lines.append('  }')
lines.extend(['}', 'export function doubleMetaphone(text) { return new DoubleMetaphone().parse(text); }', ''])
(root / 'phonetics.js').write_text('\n'.join(lines))
