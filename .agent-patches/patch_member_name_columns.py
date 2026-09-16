# -*- coding: utf-8 -*-
"""مواءمة الواجهة مع 0163: sent_by_email ← sent_by_name، user_email ← user_name."""
import sys


def patch(path, edits):
    raw = open(path, "rb").read()
    nl = "\r\n" if b"\r\n" in raw else "\n"
    src = raw.decode("utf-8").replace("\r\n", "\n")
    for old, new, label in edits:
        if src.count(old) != 1:
            sys.exit("ANCHOR %s in %s: count=%d" % (label, path, src.count(old)))
        src = src.replace(old, new, 1)
    open(path, "wb").write(src.replace("\n", nl).encode("utf-8"))
    print("%s: patched (EOL=%s)" % (path, "CRLF" if nl == "\r\n" else "LF"))


# ── لوحة الاستقبال ────────────────────────────────────────────────────────
patch(
    "client/components/reception/ReceptionBoard.tsx",
    [
        ("  sent_by_email: string | null;", "  sent_by_name: string | null;", "queue-type"),
        (
            """                  <TableCell className="whitespace-nowrap text-xs">
                    {row.sent_by_email ?? "—"}
                  </TableCell>""",
            """                  <TableCell className="whitespace-nowrap text-xs">
                    {row.sent_by_name ?? "—"}
                  </TableCell>""",
            "queue-cell",
        ),
    ],
)

# ── شبكة دفعات الفاتورة ───────────────────────────────────────────────────
patch(
    "client/components/billing/InvoiceDetailsDialog.tsx",
    [
        (
            '''          "payment_method_name, register_name, doctor_name, user_email, amount, " +''',
            '''          "payment_method_name, register_name, doctor_name, user_name, amount, " +''',
            "payments-select",
        ),
        (
            """                            <TableCell className="whitespace-nowrap text-xs">{row.user_email ?? "—"}</TableCell>""",
            """                            <TableCell className="whitespace-nowrap text-xs">{row.user_name ?? "—"}</TableCell>""",
            "payments-cell",
        ),
    ],
)

# ── سند الدفعة المطبوع ────────────────────────────────────────────────────
patch(
    "client/lib/payment-receipt.ts",
    [
        ("  user_email: string | null;", "  user_name: string | null;", "receipt-type"),
        (
            """    ${line("المستخدم", row.user_email)}""",
            """    ${line("المستخدم", row.user_name)}""",
            "receipt-line",
        ),
    ],
)
