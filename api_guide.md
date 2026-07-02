<USER_REQUEST>
сделай мне приложение куда я смогу выгрузить свои изображения ввести свои промты и за раз их всех оживить с помощью grok imagen вот инструкция по интеграции geminigen api для генерации видео через грок - # GeminiGen.ai — Полное руководство по API


> **Для кого:** Этот документ — инструкция для ИИ-модели (или разработчика), которая должна научиться правильно работать с API платформы GeminiGen.ai. Здесь описаны ВСЕ эндпоинты, параметры, форматы ответов и подводные камни.


---


## Что такое GeminiGen.ai


GeminiGen.ai — это платформа-агрегатор для генерации медиа (картинки и видео) через единый API. Она предоставляет доступ к нескольким моделям:


| Модель | Тип | Назначение |
|--------|-----|------------|
| `nano-banana-pro` | Изображения | Генерация картинок по текстовому промпту |
| `veo-3.1-fast` | Видео | Генерация видео (Google Veo) с опциональным reference-кадром |
| `grok-3` | Видео | Генерация видео (xAI Grok) с опциональным reference-кадром |


---


## Общие принципы API


### Base URL
```
https://api.geminigen.ai
```


### Авторизация
Все запросы авторизуются через заголовок `x-api-key`:
```
x-api-key: geminiai-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```


> ⚠️ **НЕ используй** `Authorization: Bearer ...` — GeminiGen.ai использует **только** `x-api-key`.


### Формат данных
Все запросы на генер
<truncated 19742 bytes>
──────────────────────────────────────┤
│                    ГЕНЕРАЦИЯ ВИДЕО (GROK)                │
│                                                         │
│  POST /uapi/v1/video-gen/grok                           │
│  ├── prompt: "описание ДВИЖЕНИЯ"                        │
│  ├── model: "grok-3"                                    │
│  ├── aspect_ratio: "portrait"                           │
│  ├── resolution: "720p"                                 │
│  ├── duration: "6"                                      │
│  ├── mode: "custom"                                     │
│  └── file_urls: "https://url-картинки.png"              │
│  → получаешь uuid                                       │
│                                                         │
│  GET /uapi/v1/history/{uuid}                            │
│  → ждёшь status === 2                                   │
│  → берёшь generated_video[0].video_url                  │
└─────────────────────────────────────────────────────────┘


Авторизация: x-api-key (заголовок)
Формат тела: multipart/form-data (FormData)
Статусы: 1=в процессе, 2=готово, >2=ошибка
Polling: каждые 5 сек, картинки до 5 мин, видео до 10 мин
```




</USER_REQUEST>
<ADDITIONAL_METADATA>
The current local time is: 2026-05-21T22:47:23+06:00.
</ADDITIONAL_METADATA>
<USER_SETTINGS_CHANGE>
The user changed setting `Model Selection` from None to Gemini 3.5 Flash (High). No need to comment on this change if the user doesn't ask about it. If reporting what model you are, please use a human readable name instead of the exact string.
</USER_SETTINGS_CHANGE>