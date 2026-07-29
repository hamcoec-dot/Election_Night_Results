import os
import csv
import json
import re

def read_csv_robust(file_path):
    try:
        with open(file_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
            return list(csv.reader(f))
    except Exception:
        with open(file_path, 'r', encoding='cp1252', errors='ignore') as f:
            return list(csv.reader(f))

def clean_num(val):
    if not val:
        return 0
    clean = str(val).replace(',', '').strip()
    try:
        if '.' in clean:
            return float(clean)
        return int(clean)
    except ValueError:
        return 0

def run_verification(early_csv, ed_csv, js_path=None):
    """
    Independent Verification Engine for Hamilton County Election Results.
    Audits generated data.js against Early and ED CSV files.
    - Audits Metadata (Title, Date, County)
    - Audits Turnout Statistics (Voters, Ballots, Turnout %)
    - Audits Contest presence & Precinct reporting counts
    - Audits Candidate Vote Totals & Mathematical Sums across Early and ED CSVs
    """
    if js_path is None:
        js_path = ed_csv
        ed_csv = None

    print(f"=== ELECTION RESULTS VERIFICATION ENGINE ===")
    print(f"Early CSV: {early_csv}")
    print(f"ED CSV:    {ed_csv}")
    print(f"Target JS: {js_path}\n")

    if not os.path.exists(js_path):
        print(f"[FAIL] Missing JS file: {js_path}")
        return False

    with open(js_path, 'r', encoding='utf-8') as f:
        js_content = f.read()

    try:
        json_str = js_content.split('window.ELECTION_DATA = ')[1].rstrip(';\n')
        js_data = json.loads(json_str)['latest']
    except Exception as e:
        print(f"[FAIL] Invalid data.js payload: {e}")
        return False

    passed_checks = 0
    failed_checks = 0

    def check(condition, description):
        nonlocal passed_checks, failed_checks
        if condition:
            print(f"  [PASS] {description}")
            passed_checks += 1
        else:
            print(f"  [FAIL] {description}")
            failed_checks += 1

    primary_csv = ed_csv if ed_csv else early_csv
    if not primary_csv or not os.path.exists(primary_csv):
        print(f"[FAIL] Missing primary CSV file: {primary_csv}")
        return False

    rows = read_csv_robust(primary_csv)

    print("--- 1. Metadata & Header Verification ---")
    raw_title = rows[1][0].strip() if len(rows) > 1 and rows[1][0] else "General Election"
    raw_date = rows[2][0].strip() if len(rows) > 2 and rows[2][0] else ""
    raw_county = rows[2][4].strip() if len(rows) > 2 and len(rows[2]) > 4 and rows[2][4] else "Hamilton"

    check(js_data['electionTitle'] == raw_title, f"Election Title matches ('{raw_title}')")
    check(js_data['electionDate'] == raw_date, f"Election Date matches ('{raw_date}')")
    check(js_data['county'] == raw_county, f"County Name matches ('{raw_county}')")

    print("\n--- 2. Turnout Statistics Verification ---")
    early_rows = read_csv_robust(early_csv) if (early_csv and os.path.exists(early_csv)) else []
    ed_rows = read_csv_robust(ed_csv) if (ed_csv and os.path.exists(ed_csv)) else []

    early_voters = 0
    early_ballots = 0
    for r in early_rows:
        if len(r) > 0 and r[0] == 'Totals':
            early_voters = clean_num(r[1]) if len(r) > 1 else 0
            early_ballots = clean_num(r[2]) if len(r) > 2 else 0
            break

    ed_voters = 0
    ed_ballots = 0
    for r in ed_rows:
        if len(r) > 0 and r[0] == 'Totals':
            ed_voters = clean_num(r[1]) if len(r) > 1 else 0
            ed_ballots = clean_num(r[2]) if len(r) > 2 else 0
            break

    expected_voters = max(early_voters, ed_voters)
    expected_ballots = early_ballots + ed_ballots
    expected_turnout = round((expected_ballots / expected_voters * 100), 2) if expected_voters > 0 else 0.0

    check(js_data['totalVoters'] == expected_voters, f"Registered Voters count ({js_data['totalVoters']} == {expected_voters})")
    check(js_data['totalBallots'] == expected_ballots, f"Total Ballots Cast ({js_data['totalBallots']} == {expected_ballots})")
    check(js_data['turnoutPercent'] == expected_turnout, f"Turnout Percentage ({js_data['turnoutPercent']}% == {expected_turnout}%)")

    print("\n--- 3. Dynamic Contest, Precinct & Candidate Audit ---")
    js_contests = {c['title']: c for c in js_data['contests']}

    def find_all_raw_contests(rows):
        found = {}
        if not rows:
            return found
        i = 0
        while i < len(rows):
            row = rows[i]
            reporting_cells = [(idx, cell) for idx, cell in enumerate(row) if 'Precincts Reporting' in cell]
            if reporting_cells:
                contest_row = rows[i-2] if i >= 2 else []
                for k, (col_idx, rep_text) in enumerate(reporting_cells):
                    c_name = contest_row[col_idx].strip() if col_idx < len(contest_row) and contest_row[col_idx] else ""
                    if c_name:
                        rep_match = re.search(r'(\d+)\s+of\s+(\d+)\s+Precincts\s+Reporting', rep_text, re.IGNORECASE)
                        p_rep = int(rep_match.group(1)) if rep_match else 0
                        p_tot = int(rep_match.group(2)) if rep_match else 0
                        found[c_name] = (p_rep, p_tot)
                totals_row_idx = None
                for r_idx in range(i + 2, len(rows)):
                    if len(rows[r_idx]) > 0 and rows[r_idx][0] == 'Totals':
                        totals_row_idx = r_idx
                        break
                i = totals_row_idx if totals_row_idx else i + 1
            i += 1
        return found

    early_contests_info = find_all_raw_contests(early_rows)
    ed_contests_info = find_all_raw_contests(ed_rows)

    raw_contests_found = set(list(early_contests_info.keys()) + list(ed_contests_info.keys()))

    MAX_PRECINCT_CAP = 92
    for c_name in raw_contests_found:
        check(c_name in js_contests, f"Contest '{c_name}' present in JS dataset")
        if c_name in js_contests:
            js_c = js_contests[c_name]
            if ed_rows and c_name in ed_contests_info:
                p_rep, p_tot = ed_contests_info[c_name]
            elif ed_rows and c_name not in ed_contests_info:
                p_rep, p_tot = 0, early_contests_info.get(c_name, (0, 0))[1]
            else:
                p_rep, p_tot = 0, early_contests_info.get(c_name, (0, 0))[1]

            expected_rep_cnt = min(p_rep, MAX_PRECINCT_CAP)
            expected_tot_cnt = min(p_tot, MAX_PRECINCT_CAP)

            check(js_c['precinctsReporting'] == expected_rep_cnt, f"'{c_name}' Precincts Reported ({js_c['precinctsReporting']} == {expected_rep_cnt})")
            check(js_c['precinctsTotal'] == expected_tot_cnt, f"'{c_name}' Total Precincts ({js_c['precinctsTotal']} == {expected_tot_cnt})")

    check(len(js_contests) == len(raw_contests_found), f"Total contest count matches ({len(js_contests)} == {len(raw_contests_found)})")

    print("\n--- 4. Candidate Vote Totals & Mathematical Sum Audit ---")
    def extract_contest_candidate_votes(rows):
        res = {}
        if not rows:
            return res
        i = 0
        while i < len(rows):
            row = rows[i]
            reporting_cells = [(idx, cell) for idx, cell in enumerate(row) if 'Precincts Reporting' in cell]
            if reporting_cells:
                contest_row = rows[i-2] if i >= 2 else []
                candidate_row = rows[i+1] if i+1 < len(rows) else []

                totals_row_idx = None
                for r_idx in range(i + 2, len(rows)):
                    if len(rows[r_idx]) > 0 and rows[r_idx][0] == 'Totals':
                        totals_row_idx = r_idx
                        break

                for k, (col_idx, rep_text) in enumerate(reporting_cells):
                    c_name = contest_row[col_idx].strip() if col_idx < len(contest_row) and contest_row[col_idx] else ""
                    if not c_name:
                        continue
                    if c_name not in res:
                        res[c_name] = {}

                    next_contest_col = reporting_cells[k+1][0] if k + 1 < len(reporting_cells) else len(candidate_row)

                    for c_idx in range(col_idx, next_contest_col):
                        if c_idx >= len(candidate_row):
                            break
                        cand_raw = candidate_row[c_idx].strip()
                        if not cand_raw or 'write-in' in cand_raw.lower():
                            continue

                        cand_clean = cand_raw
                        for p in ['REP ', 'DEM ', 'IND ']:
                            if cand_clean.startswith(p):
                                cand_clean = cand_clean[len(p):].strip()

                        raw_votes = clean_num(rows[totals_row_idx][c_idx]) if (totals_row_idx is not None and c_idx < len(rows[totals_row_idx])) else 0
                        res[c_name][cand_clean] = max(res[c_name].get(cand_clean, 0), raw_votes)

                i = totals_row_idx if totals_row_idx else i + 1
            i += 1
        return res

    early_cand_map = extract_contest_candidate_votes(early_rows)
    ed_cand_map = extract_contest_candidate_votes(ed_rows)

    all_verified_contests = set(list(early_cand_map.keys()) + list(ed_cand_map.keys()))

    for c_title in all_verified_contests:
        if c_title in js_contests:
            js_c = js_contests[c_title]
            js_cand_map = {cand['name']: cand for cand in js_c['candidates']}

            early_c_cands = early_cand_map.get(c_title, {})
            ed_c_cands = ed_cand_map.get(c_title, {})
            all_cands = set(list(early_c_cands.keys()) + list(ed_c_cands.keys()))

            for cand_name in all_cands:
                expected_votes = early_c_cands.get(cand_name, 0) + ed_c_cands.get(cand_name, 0)
                check(cand_name in js_cand_map, f"Candidate '{cand_name}' present in '{c_title}'")
                if cand_name in js_cand_map:
                    actual_votes = js_cand_map[cand_name]['votes']
                    check(actual_votes == expected_votes, f"Candidate '{cand_name}' vote sum ({actual_votes} == {expected_votes}) in '{c_title}'")

    print("\n==========================================")
    print(f"VERIFICATION SUMMARY: {passed_checks} PASSED, {failed_checks} FAILED")
    print("==========================================")

    return failed_checks == 0

if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.abspath(__file__))
    results_dir = os.path.join(base_dir, 'Results')
    sample_dir = os.path.join(base_dir, 'SampleData')
    
    early_csv = None
    ed_csv = None
    for s_dir in [results_dir, sample_dir, base_dir]:
        if os.path.exists(s_dir):
            all_csvs = [os.path.join(s_dir, f) for f in os.listdir(s_dir) if f.upper().endswith('.CSV')]
            if all_csvs:
                all_csvs.sort(key=lambda x: os.path.getmtime(x), reverse=True)
                ed_files = [f for f in all_csvs if 'ED' in os.path.basename(f).upper()]
                non_ed_files = [f for f in all_csvs if 'ED' not in os.path.basename(f).upper()]
                if ed_files:
                    ed_csv = ed_files[0]
                if non_ed_files:
                    early_csv = non_ed_files[0]
        if early_csv or ed_csv:
            break

    js_file = os.path.join(base_dir, 'data.js')
    success = run_verification(early_csv, ed_csv, js_file)
    exit(0 if success else 1)
