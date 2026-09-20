# -*- coding: utf-8 -*-
"""أيقونة `Trash2` الناقصة في شاشة المرضى.

كشفها `tsc --noResolve` بـTS2304 قبل البناء — وهو بالضبط الخطأ الذي يُنتجه
الترقيع بالنصّ: يُضاف استعمالٌ وتُنسى إضافة استيراده.
"""
import sys

PATH = "client/pages/Patients.tsx"

raw = open(PATH, "rb").read()
NL = "\r\n" if b"\r\n" in raw else "\n"
src = raw.decode("utf-8").replace("\r\n", "\n")

OLD = """  SlidersHorizontal,
  Upload,"""
NEW = """  SlidersHorizontal,
  Trash2,
  Upload,"""

if src.count(OLD) != 1:
    sys.exit("ANCHOR icons: count=%d" % src.count(OLD))
src = src.replace(OLD, NEW, 1)

open(PATH, "wb").write(src.replace("\n", NL).encode("utf-8"))
print("Patients.tsx: Trash2 imported, NL=%r" % NL)
