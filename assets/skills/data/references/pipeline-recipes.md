# Pipeline recipes

A recurring analysis becomes an amauta pipeline (`.amauta/pipelines.json`, see docs/pipelines.md). amauta runs the
steps, streams their output and keeps the history; it has no database, workbook or mail drivers. Those steps are the
project's own scripts, sketched below. Adapt them; do not paste real names, servers, recipients or rules into the
repository: they go in a config file outside it or in the user's private profile.

## The definition

```json
{ "pipelines": [ {
  "id": "weekly-report", "name": "Weekly report", "category": "Reporting",
  "schedule": { "at": "07:30", "days": ["mon"] },
  "steps": [
    { "name": "Extract", "type": "python", "script": "etl/sql_to_parquet.py", "args": ["sql/weekly.sql", "out/weekly.parquet"],
      "retries": 2, "retry_delay": 60, "timeout": 1800, "outputs": ["out/weekly.parquet"] },
    { "name": "Refresh workbook", "type": "python", "script": "etl/refresh_workbook.py", "args": ["reports/weekly.xlsx"],
      "timeout": 900, "outputs": ["reports/weekly.xlsx"] },
    { "name": "Send", "type": "python", "script": "etl/send_mail.py", "args": ["reports/weekly.xlsx"] } ] } ] }
```

- `retries` covers the failures that pass on their own: a dropped database connection, a busy share.
- `outputs` turns "the script exited 0 but wrote nothing" into a failure: a query that returned nothing new, a
  workbook that did not refresh.
- Run `amauta pipeline check` after editing: it finds a missing script, program or folder before a run does.
- Credentials never go in the definition (amauta refuses a secret-like value there). Use Windows integrated
  authentication, an environment variable, or a config file outside the repository that only the user can read.

## SQL script to Parquet (any database with an ODBC driver)

Scripts written for SQL Server tools separate batches with a line that holds only `GO`; a driver does not understand
it, so split first. The last batch is the query whose rows are kept.

```python
"""sql_to_parquet.py SQL_FILE OUT_FILE: run the script's batches, save the last one's rows."""
import os, re, sys, time
import pyodbc            # third-party: pip install pyodbc pandas pyarrow
import pandas as pd

sql_file, out_file = sys.argv[1], sys.argv[2]
batches = [b.strip() for b in re.split(r"^\s*GO\s*;?\s*$", open(sql_file, encoding="utf-8").read(), flags=re.I | re.M) if b.strip()]
conn = pyodbc.connect(os.environ["REPORT_DB"], autocommit=True)  # a connection string kept outside the repository
try:
    cur = conn.cursor()
    for n, batch in enumerate(batches[:-1], 1):
        t0 = time.time()
        cur.execute(batch)
        while cur.nextset():
            pass
        print(f"batch {n}/{len(batches)} done in {time.time() - t0:.1f} s", flush=True)
    frame = pd.read_sql(batches[-1], conn)
finally:
    conn.close()
os.makedirs(os.path.dirname(out_file) or ".", exist_ok=True)
frame.to_parquet(out_file, index=False)
print(f"{len(frame):,} rows -> {out_file}")
```

Print counts and timings, never rows: every output line is kept in the run's history (redacted, but still).

## Refresh a workbook (Windows with Excel)

Background refresh lets `RefreshAll` return before the data arrives, so turn it off and wait. Excel started through
COM is not a child of the step's process, so a step timeout cannot stop it: quit it in `finally`.

```python
"""refresh_workbook.py WORKBOOK: refresh every connection and pivot, wait for them, save."""
import os, sys, time
import win32com.client   # third-party: pip install pywin32

path = os.path.abspath(sys.argv[1])
excel = win32com.client.DispatchEx("Excel.Application")
excel.Visible, excel.DisplayAlerts = False, False
book = None
try:
    book = excel.Workbooks.Open(path)
    for c in book.Connections:
        for kind in ("OLEDBConnection", "ODBCConnection"):
            try:
                getattr(c, kind).BackgroundQuery = False
            except Exception:
                pass
    t0 = time.time()
    book.RefreshAll()
    excel.CalculateUntilAsyncQueriesDone()
    print(f"refreshed {book.Connections.Count} connections in {time.time() - t0:.1f} s", flush=True)
    book.Save()
finally:
    if book is not None:
        book.Close(SaveChanges=False)
    excel.Quit()
```

## Send or reply by mail (Windows with Outlook)

Send only on a scheduled run, so trying the pipeline from the portal or the terminal mails nobody. Recipients and
the thread's subject come from a config file outside the repository; dates are computed here.

```python
"""send_mail.py ATTACHMENT: mail the report, or reply to all on the newest message of the thread."""
import datetime, json, os, sys
import win32com.client   # third-party: pip install pywin32

if os.environ.get("AMAUTA_PIPELINE_TRIGGER") != "schedule" and "--force" not in sys.argv:
    print("not a scheduled run: no mail sent (add --force to send anyway)")
    sys.exit(0)
cfg = json.load(open(os.path.expanduser("~/.config/weekly-report/mail.json"), encoding="utf-8"))
cut = (datetime.date.today() - datetime.timedelta(days=1)).strftime("%d/%m/%Y")
outlook = win32com.client.Dispatch("Outlook.Application")
mail = None
if cfg.get("thread_subject"):
    ns = outlook.GetNamespace("MAPI")
    newest = None
    for folder in (ns.GetDefaultFolder(6), ns.GetDefaultFolder(5)):  # Inbox, Sent Items
        items = folder.Items
        items.Sort("[ReceivedTime]", True)
        for item in items:
            if cfg["thread_subject"].lower() in str(getattr(item, "Subject", "")).lower():
                if newest is None or item.ReceivedTime > newest.ReceivedTime:
                    newest = item
                break
    mail = newest.ReplyAll() if newest else None
if mail is None:
    mail = outlook.CreateItem(0)
    mail.To, mail.CC, mail.Subject = cfg["to"], cfg.get("cc", ""), cfg["subject"].format(cut=cut)
mail.HTMLBody = cfg["body_html"].format(cut=cut) + mail.HTMLBody
mail.Attachments.Add(os.path.abspath(sys.argv[1]))
mail.Send()
print("mail sent")
```

## A notebook updated in place

The `notebook` step writes `<name>.run.ipynb` and leaves the source untouched. To refresh the notebook itself, run it
from a script with `nbclient` (`nbformat.read`, `NotebookClient(nb, timeout=1200).execute()`, `nbformat.write`) as a
`python` step, and name the notebook in `outputs`.
