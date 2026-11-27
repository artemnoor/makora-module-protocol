# Руководство разработчика MMP

[English](developer-guide.md) · [Спецификация](../spec/0.1.0/overview.md) · [Обзор на русском](../README.ru.md)

MMP позволяет связывать независимые модули через MCP по версии контракта. Это полезно, когда модуль запрашивает зависимость по возможности или оператору нужно поменять её реализацию. Обычные алгоритмы, модели и внешние сервисы используют одни правила взаимодействия.

## Установка и первый модуль

Установите MMP 0.1.0 из публичного реестра npm в своём проекте на Node.js 22.13 или новее:

```sh
npm install @artemnoor/mmp@0.1.0
```

Либо соберите архив в исходном репозитории и установите файл в отдельный проект Node.js 22.13+:

```sh
# в исходном репозитории
npm ci
npm pack
```

```sh
# в своём проекте
npm install /путь/artemnoor-mmp-0.1.0.tgz
```

Архив — локальная установка, пакет при этом не публикуется. Установка из реестра использует только `https://registry.npmjs.org/`; проверка ниже не переходит на локальный архив при ошибке.

| Импорт | Публичная поверхность |
| --- | --- |
| `@artemnoor/mmp` | SDK модуля, `revision`, `profile`, `extension`, `readProtocolSchema`, идентификаторы протокола, помощники результата и типы TypeScript |
| `@artemnoor/mmp/host` | `startHost`, `HostConfig`, типы политики и Reference Host |
| `@artemnoor/mmp/schemas/invoke` | JSON Schema вызова. Также экспортируются `module-descriptor`, `execution-context` и `error`. |

Пакет — единственный MMP-импорт для потребителя. Модулю на TypeScript также нужен официальный MCP stdio server `@modelcontextprotocol/server@2.4.0`, как в шаблоне; файлы из checkout не импортируются. Минимальный модуль использует ту же публичную поверхность, что [шаблон TypeScript](../templates/typescript/server.ts), и артефакт `contract.json` из следующего раздела:

```ts
import { readFileSync } from "node:fs";
import { createModule, structured, type Descriptor, type JsonObject } from "@artemnoor/mmp";
import { serveStdio } from "@modelcontextprotocol/server/stdio";

const { schema } = JSON.parse(
  readFileSync(new URL("../contract.json", import.meta.url), "utf8"),
) as { schema: JsonObject & { $id: string } };

const descriptor: Descriptor = {
  id: "org.example.echo",
  publisher: "org.example",
  version: "1.0.0",
  mmpVersion: "0.1.0",
  description: "Return a message unchanged",
  requires: [],
  operations: [{
    capability: "org.example/echo",
    inputContract: schema.$id,
    outputContract: schema.$id,
    tool: "echo",
    effects: "read-only",
    permissions: [],
    execution: "sync",
    idempotency: { mode: "natural" },
  }],
};

serveStdio(() => createModule(descriptor, {
  echo: { inputSchema: schema, outputSchema: schema, run: input => structured(input) },
}, {
  gateway: process.env.MMP_GATEWAY,
  credential: process.env.MMP_CREDENTIAL,
  hostGrant: process.env.MMP_HOST_GRANT,
}));
```

Скомпилируйте модуль в `dist/server.js` установленным компилятором, например `npx tsc server.ts --target ES2023 --module NodeNext --strict --outDir dist`. Модуль на Python может работать напрямую с официальным `mcp==2.3.0`.

Проверка установленного пакета вне checkout:

```sh
node experiments/release/sdk-consumer.mjs /путь/artemnoor-mmp-0.1.0.tgz
node experiments/release/sdk-consumer.mjs @artemnoor/mmp@0.1.0
```

Скрипт создаёт пустой временный проект, устанавливает пакет и закреплённый компилятор, собирает свой модуль TypeScript в строгом режиме по установленным декларациям, импортирует и сравнивает все четыре схемы, затем запускает Reference Host и вызывает свежий ESM-модуль. При ошибке он завершается с ненулевым кодом, ничего не импортирует из checkout, ничего не публикует и не переходит с публичного реестра на tarball. [Скрипт](../experiments/release/sdk-consumer.mjs)

1. Возьмите [шаблон TypeScript или Python](../templates/). Подготовьте JSON Schema 2020-12, постоянный версионированный `$id`, описание смысла и примеры валидных и невалидных данных. Смена смысла требует нового идентификатора.
2. Объявите дескриптор в `server/discover` под `capabilities.extensions["io.github.artemnoor/mmp"].descriptor`. Для каждой операции укажите MCP tool, возможность, оба контракта, права, эффекты и идемпотентность. Опубликуйте схемы операции в `tools/list`, а объект успешного результата в `structuredContent`.
3. Добавьте пакет и SHA-256 его доверенных файлов, контракт и разрешения в конфигурацию `startHost`. Для каждого разрешения укажите непосредственного вызывающего, целевой модуль и инструмент. [Конфигурация с примером вызова](developer-guide.md#connect-to-the-reference-host)
4. Для замены подключите поставщика с собственным идентификатором пакета и совпадающей тройкой «возможность, вход, выход». Выдайте разрешение и выберите его через `host.select(triple, moduleId)` до нового корневого вызова.

## Зависимости и пользовательский интерфейс

Внесите тройку в `requires` вызывающего модуля и выдайте ему доступ к операции. В TS-обработчике используйте `call.invoke`. При реализации на другом языке вызовите `mmp_invoke` через отдельное MCP-соединение с Gateway, используя выданный credential и ссылку на текущий вызов. Reference Host передаёт адрес через `MMP_GATEWAY`, credential через `MMP_CREDENTIAL`, разрешение защищённой операции через `MMP_HOST_GRANT`. [Формат вызова и обработка ошибок](../spec/0.1.0/module-calls.md)

Harness может встроить интерфейс собственными средствами. В лаборатории модуль указывает MCP-ресурс формы, браузер показывает его в sandboxed iframe, а приложение проверяет ввод и продолжает через новый корневой вызов. Граф и состояние ожидания остаются у приложения. [Лаборатория](../demos/universality/README.md) · [MCP Apps](https://modelcontextprotocol.io/extensions/apps/overview)

## Свой Host и проверка соответствия

Используйте базовый MCP 2026-07-28 и нормативные правила профиля. [Руководство по реализации Host](host-implementer.md) описывает границы без привязки к языку и отдельно фиксирует совместимость. Проверьте допуск версии и пакета, соответствие дескриптора и схем, разрешения непосредственного вызывающего, точные контракты, закрепление поставщика, дедлайны, отмену, циклы и заявленные гарантии дедупликации. Stdio создаёт процесс. Для доверительной границы недоверенных модулей нужна отдельная изоляция ОС.

В checkout MMP запустите общий набор против обоих Host:

```sh
npm run verify:hosts
npm run verify:external:hosts
```

`verify:hosts` прогоняет одни и те же случаи через тонкий TypeScript-адаптер над `startHost` и мост к [Python Host](https://github.com/artemnoor/makora-module-protocol/blob/main/python-host/README.md); отсутствие Python Host или его зависимостей — ошибка, не пропуск. `verify:external:hosts` прогоняет те же JSON-графы и модули через оба Host в изолированном рабочем каталоге. [Общие случаи](https://github.com/artemnoor/makora-module-protocol/blob/main/conformance/README.md) используют только нормативные формы обмена и публичный API Host, без приватных внутренностей. Дополнительно выполните [Spike](../spike/README.md) и `npm run verify:external`. Текущие результаты записаны в [отчёте о выпуске](release-0.1.0.md); свои результаты фиксируйте по редакции протокола и явно указывайте особенности реализации, например долговечную дедупликацию.
