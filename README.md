# HemCenter_2.0

## AI-агент (Claude API)

Черновой каркас агента с доступом к данным пациентов и анализов через
tool use (сейчас — на моковой SQLite-базе, `agent/db.py`).

### Запуск

```bash
pip install -r requirements.txt
cp .env.example .env   # укажите ANTHROPIC_API_KEY
export $(cat .env | xargs)
python -m agent.main
```

### Структура

- `agent/db.py` — подключение к БД + сидовые данные (заменить на реальную БД)
- `agent/tools.py` — инструменты агента (`search_patients`, `get_patient`, `get_lab_results`)
- `agent/main.py` — интерактивный CLI-цикл на `client.beta.messages.tool_runner`
