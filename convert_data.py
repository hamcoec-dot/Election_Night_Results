import os
import csv
import json
import re
from verify import run_verification

def read_csv_robust(file_path):
    """Read CSV file supporting UTF-8 BOM and Windows-1252 encodings."""
    try:
        with open(file_path, 'r', encoding='utf-8-sig', errors='ignore') as f:
            return list(csv.reader(f))
    except Exception:
        with open(file_path, 'r', encoding='cp1252', errors='ignore') as f:
            return list(csv.reader(f))

def clean_num(val):
    """Convert formatted string numbers to integers/floats."""
    if not val:
        return 0
    clean = str(val).replace(',', '').strip()
    try:
        if '.' in clean:
            return float(clean)
        return int(clean)
    except ValueError:
        return 0

def parse_election_csv(file_path):
    """
    Parses a single election CSV export file into a structured dictionary.
    Excludes Write-in candidates/totals completely.
    Preserves EXACT contest order and candidate order as they appear in the CSV file.
    ROBUST DATA CALCULATION: Calculates X of Y precincts reporting 100% dynamically from precinct data rows.
    PRECINCT CAP MANDATE: Hard-caps any precinct reporting or total precinct count at 92 max.
    """
    rows = read_csv_robust(file_path)
    if not rows or len(rows) < 5:
        return None

    election_title = rows[1][0].strip() if len(rows) > 1 and rows[1][0] else "General Election"
    election_date = rows[2][0].strip() if len(rows) > 2 and rows[2][0] else ""
    county_name = rows[2][4].strip() if len(rows) > 2 and len(rows[2]) > 4 and rows[2][4] else "Hamilton"
    status_label = rows[0][4].strip() if len(rows) > 0 and len(rows[0]) > 4 and rows[0][4] else "UNOFFICIAL RESULTS"

    total_voters = 0
    total_ballots = 0

    for row in rows:
        if len(row) > 0 and row[0] == 'Totals':
            total_voters = clean_num(row[1]) if len(row) > 1 else 0
            total_ballots = clean_num(row[2]) if len(row) > 2 else 0
            break

    contests = {}

    i = 0
    while i < len(rows):
        row = rows[i]
        reporting_cells = [(idx, cell) for idx, cell in enumerate(row) if 'Precincts Reporting' in cell]
        if reporting_cells:
            contest_row = rows[i-2] if i >= 2 else []
            votefor_row = rows[i-1] if i >= 1 else []
            candidate_row = rows[i+1] if i+1 < len(rows) else []

            totals_row_idx = None
            for r_idx in range(i + 2, len(rows)):
                if len(rows[r_idx]) > 0 and rows[r_idx][0] == 'Totals':
                    totals_row_idx = r_idx
                    break

            for k, (col_idx, rep_text) in enumerate(reporting_cells):
                contest_name = contest_row[col_idx].strip() if col_idx < len(contest_row) and contest_row[col_idx] else ""
                vote_for_text = votefor_row[col_idx].strip() if col_idx < len(votefor_row) and votefor_row[col_idx] else "VOTE FOR 1"
                
                if not contest_name:
                    continue

                next_contest_col = reporting_cells[k+1][0] if k + 1 < len(reporting_cells) else len(candidate_row)

                if contest_name not in contests:
                    contests[contest_name] = {
                        'title': contest_name,
                        'voteFor': vote_for_text,
                        'candidates': {},
                        'precinctsStatusMap': {}
                    }

                # Process candidates
                for c_idx in range(col_idx, next_contest_col):
                    if c_idx >= len(candidate_row):
                        break
                    cand_raw = candidate_row[c_idx].strip()
                    if not cand_raw or 'write-in' in cand_raw.lower():
                        continue

                    party = 'IND'
                    cand_name = cand_raw
                    if cand_raw.startswith('REP '):
                        party = 'REP'
                        cand_name = cand_raw[4:].strip()
                    elif cand_raw.startswith('DEM '):
                        party = 'DEM'
                        cand_name = cand_raw[4:].strip()
                    elif cand_raw.startswith('IND '):
                        party = 'IND'
                        cand_name = cand_raw[4:].strip()

                    vote_count = 0
                    if totals_row_idx is not None and totals_row_idx < len(rows):
                        tot_r = rows[totals_row_idx]
                        if c_idx < len(tot_r):
                            vote_count = clean_num(tot_r[c_idx])

                    if cand_name not in contests[contest_name]['candidates']:
                        contests[contest_name]['candidates'][cand_name] = {
                            'name': cand_name,
                            'party': party,
                            'votes': vote_count
                        }
                    else:
                        contests[contest_name]['candidates'][cand_name]['votes'] = max(
                            contests[contest_name]['candidates'][cand_name]['votes'], vote_count
                        )

                # Inspect raw precinct data rows
                if totals_row_idx is not None:
                    for d_idx in range(i + 2, totals_row_idx):
                        d_row = rows[d_idx]
                        p_name = d_row[0].strip() if len(d_row) > 0 and d_row[0] else ""
                        if not p_name:
                            continue

                        has_contest_entry = False
                        p_votes = 0
                        for c_idx in range(col_idx, min(next_contest_col, len(d_row))):
                            cell_val = d_row[c_idx].strip()
                            if cell_val != '':
                                has_contest_entry = True
                                p_votes += clean_num(cell_val)

                        if has_contest_entry:
                            if p_name not in contests[contest_name]['precinctsStatusMap']:
                                contests[contest_name]['precinctsStatusMap'][p_name] = False
                            if p_votes > 0:
                                contests[contest_name]['precinctsStatusMap'][p_name] = True

            i = totals_row_idx if totals_row_idx else i + 1
        i += 1

    formatted_contests = []
    MAX_PRECINCT_CAP = 92

    for c_title, c_data in contests.items():
        cand_list = list(c_data['candidates'].values())

        total_contest_votes = sum(c['votes'] for c in cand_list)
        max_votes = max([c['votes'] for c in cand_list], default=0)

        for c in cand_list:
            c['percentage'] = round((c['votes'] / total_contest_votes * 100), 2) if total_contest_votes > 0 else 0.0
            c['isLeading'] = (c['votes'] == max_votes and max_votes > 0)

        precincts_status_list = [
            {'name': p_name, 'reported': is_rep}
            for p_name, is_rep in c_data['precinctsStatusMap'].items()
        ]

        reported_cnt = sum(1 for p in precincts_status_list if p['reported'])
        total_prec_cnt = len(precincts_status_list)

        # STRICT MANDATED CAP AT 92
        rep_final = min(reported_cnt, MAX_PRECINCT_CAP)
        tot_final = min(total_prec_cnt, MAX_PRECINCT_CAP)

        formatted_contests.append({
            'title': c_data['title'],
            'voteFor': c_data['voteFor'],
            'precinctsReporting': rep_final,
            'precinctsTotal': tot_final,
            'totalVotes': total_contest_votes,
            'candidates': cand_list,
            'precinctsStatus': precincts_status_list
        })

    overall_rep = min(max([c['precinctsReporting'] for c in formatted_contests], default=0), MAX_PRECINCT_CAP)
    overall_tot = min(max([c['precinctsTotal'] for c in formatted_contests], default=92), MAX_PRECINCT_CAP)

    return {
        'electionTitle': election_title,
        'electionDate': election_date,
        'county': county_name,
        'statusLabel': status_label,
        'totalVoters': total_voters,
        'totalBallots': total_ballots,
        'turnoutPercent': round((total_ballots / total_voters * 100), 2) if total_voters > 0 else 0.0,
        'overallPrecinctsReporting': overall_rep,
        'overallPrecinctsTotal': overall_tot,
        'contests': formatted_contests
    }

def generate_data_js():
    base_dir = os.path.dirname(os.path.abspath(__file__))
    sample_dir = os.path.join(base_dir, 'SampleData')
    output_js_path = os.path.join(base_dir, 'data.js')

    target_csv = None
    priority_files = ['Walden Results.csv', 'RESULTS.CSV', 'WEBRESULTS.CSV', 'EV (andABS) Results.csv', 'ABS Results.csv', 'Zero Results.csv']
    
    if os.path.exists(sample_dir):
        for pf in priority_files:
            p_path = os.path.join(sample_dir, pf)
            if os.path.exists(p_path):
                target_csv = p_path
                break
        if not target_csv:
            for f in os.listdir(sample_dir):
                if f.upper().endswith('.CSV'):
                    target_csv = os.path.join(sample_dir, f)
                    break

    if not target_csv:
        for f in os.listdir(base_dir):
            if f.upper().endswith('.CSV'):
                target_csv = os.path.join(base_dir, f)
                break

    if not target_csv or not os.path.exists(target_csv):
        raise FileNotFoundError("No election results CSV file found.")

    print(f"Parsing election CSV: {target_csv}")
    parsed = parse_election_csv(target_csv)

    bundle = {
        'metadata': {
            'electionTitle': parsed['electionTitle'],
            'electionDate': parsed['electionDate'],
            'county': parsed['county'],
            'statusLabel': parsed['statusLabel'],
            'lastUpdated': 'November 5, 2024 08:45 PM'
        },
        'latest': parsed
    }

    js_content = f"// Auto-generated Election Night Results Data\nwindow.ELECTION_DATA = {json.dumps(bundle, indent=2)};\n"
    with open(output_js_path, 'w', encoding='utf-8') as f:
        f.write(js_content)

    print(f"Successfully compiled single election data CSV to {output_js_path}\n")

    # Run Verification Engine Automatically
    run_verification(target_csv, output_js_path)

if __name__ == '__main__':
    generate_data_js()
