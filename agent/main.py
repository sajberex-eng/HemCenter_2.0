"""Interactive CLI for the HemCenter clinical-data agent.

Run with: python -m agent.main
"""

import anthropic

from .db import init_db
from .tools import TOOLS

MODEL = "claude-opus-5"

SYSTEM_PROMPT = (
    "You are a clinical-data assistant for HemCenter, a hematology clinic. "
    "Use the provided tools to look up patient records and lab results. "
    "Answer only from data returned by the tools - never invent patient data, "
    "and never provide a medical diagnosis or treatment recommendation; "
    "state that such questions are for the treating physician."
)


def main() -> None:
    init_db()
    client = anthropic.Anthropic()
    messages = []

    print("HemCenter agent. Type 'exit' to quit.")
    while True:
        user_input = input("\nYou: ").strip()
        if user_input.lower() in ("exit", "quit"):
            break
        messages.append({"role": "user", "content": user_input})

        runner = client.beta.messages.tool_runner(
            model=MODEL,
            max_tokens=16000,
            system=SYSTEM_PROMPT,
            tools=TOOLS,
            messages=messages,
        )

        final = None
        for message in runner:
            final = message

        reply = next((b.text for b in final.content if b.type == "text"), "")
        print(f"\nAgent: {reply}")
        messages.append({"role": "assistant", "content": final.content})


if __name__ == "__main__":
    main()
