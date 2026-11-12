#!/usr/bin/env python3
"""Clean A Place for Mom (APFM) lead exports into one CSV for the Enquiries list.

The exports contain families' names, phones and emails. Run this on your own
computer only, keep the output in the git-ignored leads/ folder, and never paste
the spreadsheets or the output into an AI chat. The script prints counts only.

    python3 scripts/clean-apfm-leads.py "APFM Leads.xlsx" "APFM Leads July 2025.xlsx" --out leads/apfm-leads-clean.csv

Two layouts are understood:
  * Table layout (e.g. the July 2025 file): one row per lead, no header row.
    Columns: resident, -, contact, -, -, phone, contact email, other email,
    APFM advisor, advisor email, referral date, budget, extra.
  * Portal copy layout: one column, each lead stacked as resident name(s),
    contact name, email, phone, referral date, between portal labels such as
    "Potential Residents", "Rent + Care" and "Total".

Free-text notes and portal text are dropped. Only these columns are written.
"""

import argparse
import csv
import datetime as dt
import os
import re
import sys

import openpyxl

COLUMNS = [
    "source", "status", "contact_name", "phone", "email", "care_recipient",
    "referral_date", "budget", "apfm_advisor", "other_email", "summary",
    "from_file", "needs_review",
]
PORTAL_LABELS = {
    "potential residents", "select...", "bayshore guest home and gardens", "total",
    "rent + care", "rent", "care", "show more columns", "welcome",
}
EMAIL = re.compile(r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$")


def clean_text(v):
    return re.sub(r"\s+", " ", str(v)).strip() if v not in (None, "") else ""


def is_email(v):
    return bool(EMAIL.match(clean_text(v)))


def phone_digits(v):
    s = clean_text(v)
    if isinstance(v, float):
        s = str(int(v))
    d = re.sub(r"\D", "", s)
    if len(d) == 11 and d.startswith("1"):
        d = d[1:]
    return d


def is_phone(v):
    s = clean_text(v)
    return bool(s) and bool(re.fullmatch(r"[\d\s().+\-]{7,}", s if not isinstance(v, (int, float)) else str(int(v)))) and len(phone_digits(v)) >= 10


def fmt_phone(v):
    d = phone_digits(v)
    return f"({d[:3]}) {d[3:6]}-{d[6:]}" if len(d) == 10 else clean_text(v)


def to_date(v):
    if isinstance(v, dt.datetime):
        return v.date().isoformat()
    if isinstance(v, dt.date):
        return v.isoformat()
    m = re.match(r"^(\d{1,2})/(\d{1,2})/(\d{2,4})", clean_text(v))
    if m:
        mo, d, y = map(int, m.groups())
        y += 2000 if y < 100 else 0
        try:
            return dt.date(y, mo, d).isoformat()
        except ValueError:
            return ""
    return ""


def is_date(v):
    return bool(to_date(v))


def name_ok(n):
    return bool(n) and len(n) <= 60 and not re.search(r"[@\d$]", n)


def make_lead(file, residents, contact, phone="", email="", date="", budget="", advisor="", other_email=""):
    review = []
    contact = clean_text(contact)
    residents = [clean_text(r) for r in residents if clean_text(r)]
    if not name_ok(contact):
        review.append("check contact name")
    if any(not name_ok(r) for r in residents):
        review.append("check resident name")
    if len(residents) > 1:
        review.append("two residents listed")
    if not phone and not email:
        review.append("no phone or email")
    if phone and len(phone_digits(phone)) != 10:
        review.append("check phone")
    if not date:
        review.append("no referral date")
    bits = [f"A Place for Mom referral{' on ' + date if date else ''}."]
    if budget:
        bits.append(f"Budget {budget.replace(' /month', ' a month')}.")
    return {
        "source": "apfm",
        "status": "new",
        "contact_name": contact,
        "phone": fmt_phone(phone) if phone else "",
        "email": clean_text(email).lower(),
        "care_recipient": " & ".join(residents),
        "referral_date": date,
        "budget": budget,
        "apfm_advisor": clean_text(advisor),
        "other_email": clean_text(other_email).lower(),
        "summary": " ".join(bits),
        "from_file": os.path.basename(file),
        "needs_review": "; ".join(review),
    }


def table_layout(file, rows):
    leads = []
    for r in rows:
        r = list(r) + [None] * 13
        if not any(clean_text(c) for c in r):
            continue
        phone = r[5] if is_phone(r[5]) else ""
        email = r[6] if is_email(r[6]) else ""
        other = next((c for c in (r[7], r[12]) if is_email(c) and clean_text(c).lower() != clean_text(email).lower()), "")
        budget = clean_text(r[11]) if "$" in clean_text(r[11]) else ""
        leads.append(make_lead(file, [r[0]], r[2], phone, email, to_date(r[10]), budget, r[8], other))
    return leads


def portal_layout(file, cells):
    leads = []
    names, phone, email, date = [], "", "", ""

    def flush():
        nonlocal names, phone, email, date
        if (phone or email) and names:
            leads.append(make_lead(file, names[:-1] if len(names) > 1 else [], names[-1], phone, email, date))
        names, phone, email, date = [], "", "", ""

    for v in cells:
        s = clean_text(v)
        if not s or s.lower() in PORTAL_LABELS:
            if phone or email:
                flush()
            else:
                names = []  # stray portal text, not part of a lead
            continue
        if is_email(v):
            email = email or s
        elif is_phone(v):
            phone = phone or v
        elif is_date(v):
            date = date or to_date(v)
        elif s.startswith("$"):
            continue
        else:
            if phone or email:  # a new lead starts straight after the last one
                flush()
            if len(s) <= 60:
                names.append(s)
            else:
                names = []  # long portal or note text, not a name
            if len(names) > 3:
                names = names[-3:]
    flush()
    return leads


def read(file):
    wb = openpyxl.load_workbook(file, read_only=True, data_only=True)
    leads = []
    for i, ws in enumerate(wb.worksheets):
        rows = [r for r in ws.iter_rows(values_only=True) if any(clean_text(c) for c in r)]
        if not rows:
            continue
        wide = sum(1 for r in rows if sum(1 for c in r if clean_text(c)) >= 4) > len(rows) / 2
        if wide:
            leads += table_layout(file, rows)
        elif i == 0:
            leads += portal_layout(file, [r[0] if r else None for r in rows])
        else:
            print(f"  skipped sheet '{ws.title}' in {os.path.basename(file)} (scratch notes, not leads)")
    return leads


def merge(leads):
    """One row per family: same email or same phone counts as the same lead."""
    out, by_key = [], {}
    for lead in leads:
        keys = [k for k in (lead["email"], phone_digits(lead["phone"])) if k]
        hit = next((by_key[k] for k in keys if k in by_key), None)
        if hit is None:
            out.append(lead)
            hit = lead
        else:
            for f in COLUMNS:
                if not hit[f] and lead[f]:
                    hit[f] = lead[f]
            if lead["referral_date"] and (not hit["referral_date"] or lead["referral_date"] < hit["referral_date"]):
                hit["referral_date"] = lead["referral_date"]
            if lead["from_file"] not in hit["from_file"]:
                hit["from_file"] += f" + {lead['from_file']}"
            hit["needs_review"] = "; ".join(x for x in hit["needs_review"].split("; ") if x and not (x == "no referral date" and hit["referral_date"]) and not (x == "no phone or email" and (hit["phone"] or hit["email"])))
        for k in [k for k in (hit["email"], phone_digits(hit["phone"])) if k]:
            by_key[k] = hit
    return out


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("files", nargs="+")
    ap.add_argument("--out", default="leads/apfm-leads-clean.csv")
    a = ap.parse_args()
    raw = []
    for f in a.files:
        got = read(f)
        print(f"{os.path.basename(f)}: {len(got)} leads found")
        raw += got
    leads = merge(raw)
    leads.sort(key=lambda l: l["referral_date"] or "0000", reverse=True)
    os.makedirs(os.path.dirname(a.out) or ".", exist_ok=True)
    with open(a.out, "w", newline="", encoding="utf-8") as fh:
        w = csv.DictWriter(fh, fieldnames=COLUMNS)
        w.writeheader()
        w.writerows(leads)
    flagged = sum(1 for l in leads if l["needs_review"])
    print(f"{len(raw) - len(leads)} duplicates merged; {len(leads)} leads written to {a.out}; {flagged} flagged in needs_review")


if __name__ == "__main__":
    sys.exit(main())
