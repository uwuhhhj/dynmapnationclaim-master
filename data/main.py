#!/usr/bin/env python3
# -*- coding: utf-8 -*-

import argparse
import json
import os
import statistics
from collections import Counter
from typing import Any, Dict, Iterable, List, Optional, Tuple


DEFAULT_FILE_NAME = "dynmap_world.json"
DEFAULT_TOP_N = 50
MAX_EXAMPLE_LEN = 160


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


def walk(
    obj: Any,
    path: Tuple[str, ...],
    path_counter: Counter,
    example_map: Dict[Tuple[str, ...], str],
    type_counter_map: Dict[Tuple[str, ...], Counter],
):
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


def _safe_float(v: Any) -> Optional[float]:
    if isinstance(v, (int, float)) and not isinstance(v, bool):
        return float(v)
    return None


def _pct(part: int, total: int) -> str:
    if total <= 0:
        return "0%"
    return f"{(part / total) * 100:.1f}%"


def _describe_numbers(values: List[float]) -> str:
    if not values:
        return "(empty)"
    values_sorted = sorted(values)
    median = statistics.median(values_sorted)
    p95 = values_sorted[int(0.95 * (len(values_sorted) - 1))]
    return f"min={values_sorted[0]:.3f} median={median:.3f} p95={p95:.3f} max={values_sorted[-1]:.3f}"


def _describe_counts(counter: Counter, top_n: int) -> str:
    parts = []
    for k, c in counter.most_common(top_n):
        parts.append(f"{k}={c}")
    return ", ".join(parts) if parts else "(none)"


def _pick_first(items: Iterable[dict], predicate) -> Optional[dict]:
    for item in items:
        if predicate(item):
            return item
    return None


def analyze_players(players: Any, top_n: int):
    if not isinstance(players, list):
        print(f"\nplayers: {type_name(players)} (expected list)")
        return

    print(f"\nplayers: list (count={len(players)})")
    worlds = Counter()
    health_values: List[float] = []
    armor_values: List[float] = []
    x_values: List[float] = []
    y_values: List[float] = []
    z_values: List[float] = []
    field_presence = Counter()

    for p in players:
        if not isinstance(p, dict):
            continue
        for k in p.keys():
            field_presence[k] += 1
        if "world" in p:
            worlds[str(p.get("world"))] += 1
        for key, acc in [
            ("health", health_values),
            ("armor", armor_values),
            ("x", x_values),
            ("y", y_values),
            ("z", z_values),
        ]:
            val = _safe_float(p.get(key))
            if val is not None:
                acc.append(val)

    if worlds:
        print(f"  worlds (top {min(top_n, len(worlds))}): {_describe_counts(worlds, top_n)}")
    if health_values:
        print(f"  health: {_describe_numbers(health_values)}")
    if armor_values:
        print(f"  armor: {_describe_numbers(armor_values)}")
    if x_values:
        print(f"  x: {_describe_numbers(x_values)}")
    if y_values:
        print(f"  y: {_describe_numbers(y_values)}")
    if z_values:
        print(f"  z: {_describe_numbers(z_values)}")

    if field_presence:
        always = sorted([k for k, c in field_presence.items() if c == len(players)])
        rare = [(k, c) for k, c in field_presence.items() if c < len(players)]
        rare.sort(key=lambda kv: kv[1])
        print(f"  fields always present ({len(always)}): {', '.join(always[:20])}{'...' if len(always) > 20 else ''}")
        if rare:
            rare_str = ", ".join([f"{k}={c}" for k, c in rare[: min(top_n, len(rare))]])
            print(f"  fields not always present (top {min(top_n, len(rare))}): {rare_str}")

    sample = _pick_first(players, lambda p: isinstance(p, dict))
    if sample is not None:
        print("  sample player keys:", ", ".join(sorted(sample.keys())))


def analyze_updates(updates: Any, top_n: int, sample_n: int):
    if not isinstance(updates, list):
        print(f"\nupdates: {type_name(updates)} (expected list)")
        return

    print(f"\nupdates: list (count={len(updates)})")
    msg_counter = Counter()
    set_counter = Counter()
    icon_counter = Counter()
    ctype_counter = Counter()
    field_presence = Counter()

    point_count = 0
    area_count = 0
    polygon_sizes: List[float] = []
    point_y: List[float] = []
    point_x: List[float] = []
    point_z: List[float] = []

    for u in updates:
        if not isinstance(u, dict):
            continue
        for k in u.keys():
            field_presence[k] += 1

        msg_counter[str(u.get("msg"))] += 1
        set_counter[str(u.get("set"))] += 1
        if "ctype" in u:
            ctype_counter[str(u.get("ctype"))] += 1
        if "icon" in u:
            icon_counter[str(u.get("icon"))] += 1

        x = u.get("x")
        z = u.get("z")
        is_area = isinstance(x, list) or isinstance(z, list) or ("ytop" in u and "ybottom" in u)
        if is_area:
            area_count += 1
            if isinstance(x, list) and isinstance(z, list):
                polygon_sizes.append(float(min(len(x), len(z))))
        else:
            point_count += 1
            for key, acc in [("x", point_x), ("y", point_y), ("z", point_z)]:
                val = _safe_float(u.get(key))
                if val is not None:
                    acc.append(val)

    print(f"  kind: area/poly={area_count} ({_pct(area_count, len(updates))}), point/icon={point_count} ({_pct(point_count, len(updates))})")
    print(f"  msg (top {min(top_n, len(msg_counter))}): {_describe_counts(msg_counter, top_n)}")
    print(f"  set (top {min(top_n, len(set_counter))}): {_describe_counts(set_counter, top_n)}")
    if ctype_counter:
        print(f"  ctype (top {min(top_n, len(ctype_counter))}): {_describe_counts(ctype_counter, top_n)}")
    if icon_counter:
        print(f"  icon (top {min(top_n, len(icon_counter))}): {_describe_counts(icon_counter, top_n)}")
    if polygon_sizes:
        print(f"  polygon points: {_describe_numbers(polygon_sizes)}")

    if point_x:
        print(f"  point x: {_describe_numbers(point_x)}")
    if point_y:
        print(f"  point y: {_describe_numbers(point_y)}")
    if point_z:
        print(f"  point z: {_describe_numbers(point_z)}")

    if field_presence:
        always = sorted([k for k, c in field_presence.items() if c == len(updates)])
        rare = [(k, c) for k, c in field_presence.items() if c < len(updates)]
        rare.sort(key=lambda kv: kv[1])
        print(f"  fields always present ({len(always)}): {', '.join(always[:20])}{'...' if len(always) > 20 else ''}")
        if rare:
            rare_str = ", ".join([f"{k}={c}" for k, c in rare[: min(top_n, len(rare))]])
            print(f"  fields not always present (top {min(top_n, len(rare))}): {rare_str}")

    if sample_n > 0:
        def compact_sample(u: dict) -> dict:
            keys = [
                "id",
                "label",
                "set",
                "msg",
                "type",
                "ctype",
                "x",
                "z",
                "y",
                "ytop",
                "ybottom",
                "weight",
                "opacity",
                "color",
                "fillopacity",
                "fillcolor",
                "icon",
                "dim",
            ]
            s = {k: u.get(k) for k in keys if k in u}
            if "desc" in u:
                desc = u.get("desc")
                if isinstance(desc, str):
                    s["desc"] = desc if len(desc) <= 200 else desc[:197] + "..."
                else:
                    s["desc"] = desc
            return s

        area_sample = _pick_first(
            updates, lambda u: isinstance(u, dict) and (isinstance(u.get("x"), list) or "ytop" in u)
        )
        point_sample = _pick_first(
            updates, lambda u: isinstance(u, dict) and not (isinstance(u.get("x"), list) or "ytop" in u)
        )

        if area_sample is not None:
            print("\n  sample area/poly:")
            print(json.dumps(compact_sample(area_sample), ensure_ascii=False, indent=2))
        if point_sample is not None:
            print("\n  sample point/icon:")
            print(json.dumps(compact_sample(point_sample), ensure_ascii=False, indent=2))


def main():
    parser = argparse.ArgumentParser(description="Inspect dynmap_world.json structure and statistics")
    parser.add_argument(
        "--path",
        default=None,
        help="Path to dynmap_world.json (default: data/dynmap_world.json next to this script)",
    )
    parser.add_argument("--top", type=int, default=DEFAULT_TOP_N, help="Top N counters to print")
    parser.add_argument("--no-walk", action="store_true", help="Skip key-path walk (faster)")
    parser.add_argument("--samples", type=int, default=1, help="Print sample objects (0 to disable)")
    args = parser.parse_args()

    # 关键修复：无论你从哪里运行脚本，都以“脚本所在目录”为基准找 json
    script_dir = os.path.dirname(os.path.abspath(__file__))
    json_path = args.path or os.path.join(script_dir, DEFAULT_FILE_NAME)

    if not os.path.isfile(json_path):
        print("找不到文件：", json_path)
        print("你当前工作目录是：", os.getcwd())
        print("脚本所在目录是：", script_dir)
        print("请确认 dynmap_world.json 是否在脚本同目录（data/）下，或使用 --path 指定。")
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
        print(f"顶层是 list，长度 {len(data)}")

    if isinstance(data, dict):
        analyze_players(data.get("players"), top_n=args.top)
        analyze_updates(data.get("updates"), top_n=args.top, sample_n=args.samples)

    if not args.no_walk:
        path_counter: Counter = Counter()
        example_map: Dict[Tuple[str, ...], str] = {}
        type_counter_map: Dict[Tuple[str, ...], Counter] = {}
        walk(data, tuple(), path_counter, example_map, type_counter_map)

        print(f"\n所有 key 路径数量: {len(path_counter)}")
        print(f"\n出现次数最多的 key 路径 (Top {args.top}):")
        for p, c in path_counter.most_common(args.top):
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

