'use strict';

/**
 * Operadores Aritméticos
 * Usados para realizar cálculos matemáticos com dados numéricos:
 * + : Adição (Soma)
 * - : Subtração
 * * : Multiplicação
 * / : Divisão
 * % ou MOD : Módulo (resto da divisão inteira)
 * DIV : Divisão inteira (descarta a parte decimal)
 */
const ArithmeticOperator = Object.freeze({
    ADD: '+',
    PLUS: '+',
    SUBTRACT: '-',
    MINUS: '-',
    MULTIPLY: '*',
    DIVIDE: '/',
    MODULO: '%',
    MOD: 'MOD',
    DIV: 'DIV',
    INTEGER_DIVIDE: 'DIV'
});

/**
 * Operadores de Comparação (Relacionais)
 * Usados para comparar dois valores e retornar verdadeiro (1), falso (0) ou NULL:
 * = : Igual a
 * != ou <> : Diferente de
 * > : Maior que
 * < : Menor que
 * >= : Maior ou igual a
 * <= : Menor ou igual a
 * BETWEEN : Verifica se o valor está dentro de um intervalo
 * IN : Verifica se o valor corresponde a qualquer elemento de uma lista
 * LIKE : Compara padrões de texto (usado com coringas como % e _)
 * IS NULL / IS NOT NULL : Testa se um valor é nulo ou não nulo
 */
const ComparisonOperator = Object.freeze({
    EQUALS: '=',
    EQUAL: '=',
    EQ: '=',
    NOT_EQUALS: '!=',
    NOT_EQUAL: '!=',
    NEQ: '!=',
    NOT_EQUALS_ALT: '<>',
    DIFFERENT: '<>',
    GREATER_THAN: '>',
    GT: '>',
    LESS_THAN: '<',
    LT: '<',
    GREATER_THAN_OR_EQUAL: '>=',
    GTE: '>=',
    LESS_THAN_OR_EQUAL: '<=',
    LTE: '<=',
    BETWEEN: 'BETWEEN',
    NOT_BETWEEN: 'NOT BETWEEN',
    IN: 'IN',
    NOT_IN: 'NOT IN',
    LIKE: 'LIKE',
    NOT_LIKE: 'NOT LIKE',
    IS_NULL: 'IS NULL',
    IS_NOT_NULL: 'IS NOT NULL',
    IS: 'IS',
    IS_NOT: 'IS NOT',
    REGEXP: 'REGEXP',
    NOT_REGEXP: 'NOT REGEXP'
});

/**
 * Operadores Lógicos
 * Usados para combinar múltiplas condições em uma consulta:
 * AND : Retorna verdadeiro se todas as condições forem verdadeiras
 * OR : Retorna verdadeiro se pelo menos uma das condições for verdadeira
 * NOT ou ! : Inverte o valor lógico (transforma verdadeiro em falso e vice-versa)
 */
const LogicalOperator = Object.freeze({
    AND: 'AND',
    OR: 'OR',
    NOT: 'NOT',
    NOT_ALT: '!',
    BANG: '!'
});

/**
 * Operadores Bit a Bit (Bitwise)
 * Realizam operações em nível de bits:
 * & : E bit a bit (AND)
 * | : OU bit a bit (OR)
 * ^ : OU exclusivo bit a bit (XOR)
 * >> : Deslocamento à direita (Right shift)
 * << : Deslocamento à esquerda (Left shift)
 */
const BitwiseOperator = Object.freeze({
    AND: '&',
    BITWISE_AND: '&',
    OR: '|',
    BITWISE_OR: '|',
    XOR: '^',
    BITWISE_XOR: '^',
    RIGHT_SHIFT: '>>',
    LEFT_SHIFT: '<<',
    SHR: '>>',
    SHL: '<<'
});

/**
 * Agrupador central de todos os enumeradores de operadores
 */
const Operators = Object.freeze({
    Arithmetic: ArithmeticOperator,
    Comparison: ComparisonOperator,
    Logical: LogicalOperator,
    Bitwise: BitwiseOperator,
    // Aliases em Português
    Aritmeticos: ArithmeticOperator,
    Comparacao: ComparisonOperator,
    Logicos: LogicalOperator,
    BitwisePT: BitwiseOperator
});

// Set com todos os operadores permitidos para sanitização segura
const ALLOWED_OPERATORS = new Set([
    ...Object.values(ComparisonOperator),
    ...Object.values(ArithmeticOperator),
    ...Object.values(LogicalOperator),
    ...Object.values(BitwiseOperator)
]);

function sanitizeOperator(op, defaultOp = '=') {
    if (!op) return defaultOp;
    const upper = String(op).toUpperCase().trim();
    return ALLOWED_OPERATORS.has(upper) ? upper : defaultOp;
}

module.exports = {
    ArithmeticOperator,
    ComparisonOperator,
    LogicalOperator,
    BitwiseOperator,
    Operators,
    ALLOWED_OPERATORS,
    sanitizeOperator
};

