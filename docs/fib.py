"""斐波那契数列的三种实现。

- fib(n):     迭代版，O(n) 时间、O(1) 空间，日常首选
- fib_seq(n): 生成器版，适合需要连续一段序列的场景
- fib_rec(n): 递归 + 缓存版，写法最直观，依赖 lru_cache 才有好性能

索引约定：F(0)=0, F(1)=1, F(2)=1, F(3)=2, ...
"""

from functools import lru_cache


def fib(n: int) -> int:
    """返回第 n 个斐波那契数（迭代实现）。"""
    if n < 0:
        raise ValueError("n 必须是非负整数")
    a, b = 0, 1
    for _ in range(n):
        a, b = b, a + b
    return a


def fib_seq(count: int):
    """生成前 count 个斐波那契数。"""
    if count < 0:
        raise ValueError("count 必须是非负整数")
    a, b = 0, 1
    for _ in range(count):
        yield a
        a, b = b, a + b


@lru_cache(maxsize=None)
def fib_rec(n: int) -> int:
    """返回第 n 个斐波那契数（递归 + 记忆化）。"""
    if n < 0:
        raise ValueError("n 必须是非负整数")
    if n < 2:
        return n
    return fib_rec(n - 1) + fib_rec(n - 2)


def fib_mod(n: int, mod: int) -> int:
    """返回第 n 个斐波那契数对 mod 取模的结果，适合超大 n。"""
    if n < 0 or mod <= 0:
        raise ValueError("n 必须非负，mod 必须为正")
    a, b = 0, 1
    for _ in range(n):
        a, b = b, (a + b) % mod
    return a % mod


if __name__ == "__main__":
    print(fib(10))               # 55
    print(list(fib_seq(10)))     # [0, 1, 1, 2, 3, 5, 8, 13, 21, 34]
    print(fib_rec(50))           # 12586269025

    # Python 整数是无限精度的，第 100 项也能精确算出
    print(fib(100))              # 354224848179261915075

    # 超大 n 只关心取模结果时，用 fib_mod 更稳
    print(fib_mod(10 ** 7, 10 ** 9 + 7))
