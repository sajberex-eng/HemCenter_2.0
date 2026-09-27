"""Tool definitions the agent can call. Each function is exposed to Claude
via the @beta_tool decorator - the docstring and type hints become the
tool's schema, so keep them accurate.
"""

from anthropic import beta_tool

from .db import get_connection


@beta_tool
def search_patients(query: str) -> str:
    """Search patients by (partial) full name.

    Args:
        query: Substring to match against the patient's full name.
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT id, full_name, birth_date FROM patients WHERE full_name LIKE ?",
        (f"%{query}%",),
    ).fetchall()
    conn.close()
    if not rows:
        return "No patients matched."
    return "\n".join(f"{r['id']}: {r['full_name']} (born {r['birth_date']})" for r in rows)


@beta_tool
def get_patient(patient_id: str) -> str:
    """Get a patient's record by id.

    Args:
        patient_id: The patient's id, e.g. "p1".
    """
    conn = get_connection()
    row = conn.execute(
        "SELECT id, full_name, birth_date, diagnosis FROM patients WHERE id = ?",
        (patient_id,),
    ).fetchone()
    conn.close()
    if row is None:
        return f"No patient found with id '{patient_id}'."
    return (
        f"id: {row['id']}\nname: {row['full_name']}\n"
        f"birth_date: {row['birth_date']}\ndiagnosis: {row['diagnosis']}"
    )


@beta_tool
def get_lab_results(patient_id: str) -> str:
    """Get lab results for a patient, most recent first.

    Args:
        patient_id: The patient's id, e.g. "p1".
    """
    conn = get_connection()
    rows = conn.execute(
        "SELECT test_name, value, unit, taken_at FROM lab_results "
        "WHERE patient_id = ? ORDER BY taken_at DESC",
        (patient_id,),
    ).fetchall()
    conn.close()
    if not rows:
        return f"No lab results found for patient '{patient_id}'."
    return "\n".join(
        f"{r['taken_at']}: {r['test_name']} = {r['value']} {r['unit']}" for r in rows
    )


TOOLS = [search_patients, get_patient, get_lab_results]
