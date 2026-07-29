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

def run_verification(csv_path, js_path):
    """
    Independent Verification Engine for Hamilton County Election Results.
    Robustly audits generated data.js against raw CSV precinct data rows.
    Dynamically verifies X of Y precincts reporting count for every contest.
    """
    print(f"=== ELECTION RESULTS VERIFICATION ENGINE ===")
    print(f"Source CSV: {csv_path}")
    print(f"Target JS:  {js_path}\n")

    if not os.path.exists(csv_path):
        print(f"[FAIL] Missing CSV file: {csv_path}")
        return False
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

    rows = read_csv_robust(csv_path)

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

    # 1. Metadata Verification
    print("--- 1. Metadata & Header Verification ---")
    raw_title = rows[1][0].strip() if len(rows) > 1 and rows[1][0] else "General Election"
    raw_date = rows[2][0].strip() if len(rows) > 2 and rows[2][0] else ""
    raw_county = rows[2][4].strip() if len(rows) > 2 and len(rows[2]) > 4 and rows[2][4] else "Hamilton"

    check(js_data['electionTitle'] == raw_title, f"Election Title matches ('{raw_title}')")
    check(js_data['electionDate'] == raw_date, f"Election Date matches ('{raw_date}')")
    check(js_data['county'] == raw_county, f"County Name matches ('{raw_county}')")

    # 2. Turnout Statistics Verification
    print("\n--- 2. Turnout Statistics Verification ---")
    raw_voters = 0
    raw_ballots = 0
    for row in rows:
        if len(row) > 0 and row[0] == 'Totals':
            raw_voters = clean_num(row[1]) if len(row) > 1 else 0
            raw_ballots = clean_num(row[2]) if len(row) > 2 else 0
            break

    expected_turnout = round((raw_ballots / raw_voters * 100), 2) if raw_voters > 0 else 0.0

    check(js_data['totalVoters'] == raw_voters, f"Registered Voters count ({js_data['totalVoters']} == {raw_voters})")
    check(js_data['totalBallots'] == raw_ballots, f"Total Ballots Cast ({js_data['totalBallots']} == {raw_ballots})")
    check(js_data['turnoutPercent'] == expected_turnout, f"Turnout Percentage ({js_data['turnoutPercent']}% == {expected_turnout}%)")

    # 3. Dynamic Precinct & Candidate Audit
    print("\n--- 3. Dynamic Contest, Precinct & Candidate Audit ---")
    js_contests = {c['title']: c for c in js_data['contests']}

    raw_contests_found = set()
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
                
                raw_contests_found.add(c_name)
                next_contest_col = reporting_cells[k+1][0] if k + 1 < len(reporting_cells) else len(candidate_row)

                # Dynamically calculate X (reported) and Y (eligible) precincts from raw data rows
                eligible_p_names = []
                reported_p_names = []

                if totals_row_idx is not None:
                    for d_idx in range(i + 2, totals_row_idx):
                        d_row = rows[d_idx]
                        p_name = d_row[0].strip() if len(d_row) > 0 and d_row[0] else ""
                        if not p_name:
                            continue

                        has_entry = False
                        p_votes = 0
                        for c_idx in range(col_idx, min(next_contest_col, len(d_row))):
                            cell_val = d_row[c_idx].strip()
                            if cell_val != '':
                                has_entry = True
                                p_votes += clean_num(cell_val)

                        if has_entry:
                            eligible_p_names.append(p_name)
                            if p_votes > 0:
                                reported_p_names.append(p_name)

                expected_rep_cnt = len(reported_p_names)
                expected_tot_cnt = len(eligible_p_names)

                check(c_name in js_contests, f"Contest '{c_name}' present in JS dataset")

                if c_name in js_contests:
                    js_c = js_contests[c_name]
                    check(js_c['precinctsReporting'] == expected_rep_cnt, f"'{c_name}' Dynamic Precincts Reported ({js_c['precinctsReporting']} == {expected_rep_cnt})")
                    check(js_c['precinctsTotal'] == expected_tot_cnt, f"'{c_name}' Dynamic Total Eligible Precincts ({js_c['precinctsTotal']} == {expected_tot_cnt})")

                    # Candidate vote check
                    js_cands = {cand['name']: cand for cand in js_c['candidates']}
                    for c_idx in range(col_idx, next_contest_col):
                        if c_idx >= len(candidate_row):
                            break
                        cand_raw = candidate_row[c_idx].strip()
                        if not cand_raw:
                            continue

                        if 'write-in' in cand_raw.lower():
                            cand_clean = cand_raw
                            for p in ['REP ', 'DEM ', 'IND ']:
                                if cand_clean.startswith(p):
                                    cand_clean = cand_clean[len(p):].strip()
                            check(cand_clean not in js_cands, f"Write-in '{cand_raw}' omitted from '{c_name}'")
                            continue

                        cand_clean = cand_raw
                        for p in ['REP ', 'DEM ', 'IND ']:
                            if cand_clean.startswith(p):
                                cand_clean = cand_clean[len(p):].strip()

                        raw_votes = clean_num(rows[totals_row_idx][c_idx]) if totals_row_idx is not None and c_idx < len(rows[totals_row_idx]) else 0

                        check(cand_clean in js_cands, f"Candidate '{cand_clean}' present in '{c_name}'")
                        if cand_clean in js_cands:
                            check(js_cands[cand_clean]['votes'] == raw_votes, f"Candidate '{cand_clean}' votes ({js_cands[cand_clean]['votes']} == {raw_votes})")

            i = totals_row_idx if totals_row_idx else i + 1
        i += 1

    check(len(js_contests) == len(raw_contests_found), f"Total contest count matches ({len(js_contests)} == {len(raw_contests_found)})")

    print("\n==========================================")
    print(f"VERIFICATION SUMMARY: {passed_checks} PASSED, {failed_checks} FAILED")
    print("==========================================")

    return failed_checks == 0

if __name__ == '__main__':
    base_dir = os.path.dirname(os.path.abspath(__file__))
    csv_file = os.path.join(base_dir, 'SampleData', 'Walden Results.csv')
    js_file = os.path.join(base_dir, 'data.js')
    
    success = run_verification(csv_file, js_file)
    exit(0 if success else 1)
