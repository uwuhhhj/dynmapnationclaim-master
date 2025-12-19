#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import json
import os
from collections import Counter
from typing import Any, Tuple


FILE_NAME = "dynmap_world.json"
TOP_N = 50
MAX_EXAMPLE_LEN = 120


def type_name(v: Any) -> str:
    if v is None:
        return "null"
    if isinstance(v, bool):
        return "bool"
    if isinstance(v, int) and not isinstance(v, bool):
        return "int"
    if isinstance(v, float):
        return "float"
    if isinstance(v, str):
        return "str"
    if isinstance(v, dict):
        return "dict"
    if isinstance(v, list):
        return "list"
    return type(v).__name__


def short_repr(v: Any, max_len: int) -> str:
    s = repr(v)
    return s if len(s) <= max_len else s[: max_len - 3] + "..."


def walk(obj: Any, path: Tuple[str, ...], path_counter: Counter, example_map: dict, type_counter_map: dict):
    if isinstance(obj, dict):
        for k, v in obj.items():
            k = str(k)
            p2 = path + (k,)
            path_counter[p2] += 1
            type_counter_map.setdefault(p2, Counter())[type_name(v)] += 1

            if p2 not in example_map and not isinstance(v, (dict, list)):
                example_map[p2] = short_repr(v, MAX_EXAMPLE_LEN)

            walk(v, p2, path_counter, example_map, type_counter_map)

    elif isinstance(obj, list):
        for item in obj:
            walk(item, path + ("[]",), path_counter, example_map, type_counter_map)


def main():
    # 关键修复：无论你从哪里运行脚本，都以“脚本所在目录”为基准找 json
    script_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = os.path.join(script_dir, FILE_NAME)

    if not os.path.isfile(json_path):
        print("找不到文件：", json_path)
        print("你当前工作目录是：", os.getcwd())
        print("脚本所在目录是：", script_dir)
        print("请确认 dynmap_world.json 是否在脚本同目录（data/）下。")
        return

    with open(json_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    print(f"文件: {json_path}")
    print(f"顶层类型: {type_name(data)}")

    if isinstance(data, dict):
        print("顶层 keys:")
        for k in data.keys():
            print(f"  - {k}")
    elif isinstance(data, list):
        print(f"顶层是 list，长度: {len(data)}")

    path_counter: Counter = Counter()
    example_map = {}
    type_counter_map = {}

    walk(data, tuple(), path_counter, example_map, type_counter_map)

    print(f"\n所有 key 路径数量: {len(path_counter)}")
    print(f"\n出现次数最多的 key 路径 (Top {TOP_N}):")
    for p, c in path_counter.most_common(TOP_N):
        path_str = ".".join(p)
        types = ", ".join([f"{t}:{n}" for t, n in type_counter_map.get(p, Counter()).most_common(5)])
        ex = example_map.get(p, "")
        if ex:
            print(f"  - {path_str}  次数={c}  值类型={types}  示例={ex}")
        else:
            print(f"  - {path_str}  次数={c}  值类型={types}")

    last_key_counter = Counter()
    for p, c in path_counter.items():
        if not p:
            continue
        last = p[-1]
        if last != "[]":
            last_key_counter[last] += c

    print("\n全局字段名 Top 50:")
    for k, c in last_key_counter.most_common(50):
        print(f"  - {k}: {c}")


if __name__ == "__main__":
    main()
