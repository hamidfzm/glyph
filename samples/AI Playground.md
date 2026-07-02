---
title: AI Playground
author: Glyph Team
tags: [ai, demo, sample]
---

# AI Playground

Open the AI chat (the sparkle button in the tab bar, or `Ctrl`/`Cmd`+`Shift`+`A`) with this document active and try the prompts below. Configure a provider first in Settings → AI; a local [Ollama](https://ollama.com) server works without any API key.

## Things to try

1. Press the **Summarize** chip and watch the reply stream in.
2. Ask a follow-up: *"Shorten that to one sentence."*
3. Ask *"What does the lighthouse keeper find in the story below?"* and click **Show in document** on the quoted passage the assistant returns.
4. Select the Persian paragraph and use right-click → AI → **Translate Selection**. The reply should render right-to-left where appropriate.
5. Ask *"What files are in this workspace?"* after opening the `samples` folder as a workspace.
6. Press **Stop** mid-reply; the partial answer stays in the transcript.

## A short story to question

The lighthouse keeper of Farall Point had counted nine hundred and twelve storms from his tower, and he trusted none of them. On the morning of the nine hundred and thirteenth, the sea delivered something new: a small brass compass, wedged between the rocks, whose needle pointed steadily south-southwest no matter how he turned it. He carried it up the spiral stairs, set it beside the lamp, and watched it all night. By dawn he had decided. If the needle would not follow north, he would follow the needle.

He packed dried fish, two blankets, and the logbook he was supposed to leave behind.

## A table to interrogate

Ask the assistant which crop needs the least water, or to convert this to a bullet list.

| Crop | Water (L/kg) | Season | Yield (t/ha) |
| --- | --- | --- | --- |
| Lentils | 1,250 | Winter | 2.1 |
| Rice | 2,500 | Summer | 4.6 |
| Potatoes | 290 | Spring | 20.2 |
| Wheat | 1,800 | Winter | 3.4 |

## Some code to explain

Ask: *"Explain what this function does and its time complexity."*

```python
def moving_average(values, window):
    if window <= 0 or window > len(values):
        raise ValueError("window must be within 1..len(values)")
    total = sum(values[:window])
    result = [total / window]
    for i in range(window, len(values)):
        total += values[i] - values[i - window]
        result.append(total / window)
    return result
```

## یک بند فارسی برای آزمایش

این بند برای آزمایش پشتیبانی راست‌به‌چپ نوشته شده است. متن را انتخاب کنید و از منوی راست‌کلیک گزینه ترجمه را بزنید، یا از دستیار بخواهید آن را خلاصه کند. پاسخ دستیار باید در همان جهت درست نمایش داده شود.

## Math for a curveball

Ask the assistant to explain this identity in plain words:

$$e^{i\pi} + 1 = 0$$
