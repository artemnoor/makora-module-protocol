import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { chromium } from 'playwright';
import { startDemo } from '../server.mjs';

let demo;
let browser;

before(async () => {
  demo = await startDemo({ aiMode: 'fixture' });
  browser = await chromium.launch({ headless: true });
});

after(async () => {
  await browser?.close();
  await demo?.close();
});

async function beginRun(page, { system = 'baseline', task = 'Подготовить краткое резюме' } = {}) {
  await page.goto(demo.url);
  await page.getByLabel('Задача').fill(task);
  await page.getByLabel('Система').selectOption(system);
  await page.getByRole('button', { name: 'Запустить' }).click();
  await page.locator('#status').getByText('Ожидает ввода').waitFor();
  await page.locator('#intermediate').waitFor({ state: 'visible' });
  await page.locator('#module-ui').waitFor({ state: 'visible' });
  return page.frameLocator('#module-ui');
}

async function chooseAndResume(page, frame, choice, details = 'Горизонт ДВЕНАДЦАТЬ месяцев') {
  await frame.getByLabel('Дополнительные данные').fill(details);
  await frame.getByRole('radio', { name: choice, exact: true }).check();
  await frame.getByRole('button', { name: 'Продолжить' }).click();
  await page.locator('#result').waitFor({ state: 'visible' });
  await page.locator('#status').getByText('Завершено').waitFor();
  await page.locator('#graph').waitFor({ state: 'visible' });
  await page.locator('#history').waitFor({ state: 'visible' });
  return new URL(page.url()).searchParams.get('run');
}

for (const choice of ['Алгоритм', 'Модель']) {
  test(`baseline resumes with user choice ${choice}`, async () => {
    const context = await browser.newContext();
    try {
      const page = await context.newPage();
      const frame = await beginRun(page);
      await frame.getByText('Уточнение от модуля A').waitFor();
      const runId = await chooseAndResume(page, frame, choice);
      assert.match(await page.locator('#result').innerText(),
        choice === 'Алгоритм' ? /Алгоритм: горизонт, двенадцать, месяцев/ : /fixture\/writer.*Горизонт/);
      assert.match(await page.locator('#status').innerText(), /Завершено/);
      assert.ok(runId, 'the completed run is addressable in the URL');
      assert.equal(await page.getByLabel('Запуск').inputValue(), runId);
      await page.reload();
      await page.locator('#status').getByText('Завершено').waitFor();
      assert.equal(new URL(page.url()).searchParams.get('run'), runId);
    } finally {
      await context.close();
    }
  });
}

test('reconfigured system presents a changed module UI and completes', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const frame = await beginRun(page, { system: 'reconfigured' });
    await frame.getByText('Уточнение от модуля B').waitFor();
    assert.ok(await frame.getByLabel('Алгоритм').count(), 'reconfigured UI has an algorithm choice');
    await chooseAndResume(page, frame, 'Алгоритм');
    assert.match(await page.locator('#result').innerText(), /Independent Python contribution/);
    assert.match(await page.locator('#history').innerText(), /universal-metrics-py/);
  } finally {
    await context.close();
  }
});

test('separate browser contexts can complete runs independently', async () => {
  const contexts = await Promise.all([browser.newContext(), browser.newContext()]);
  try {
    const pages = await Promise.all(contexts.map((context) => context.newPage()));
    const frames = await Promise.all(pages.map((page, index) => beginRun(page, {
      task: `Независимая задача ${index + 1}`,
    })));

    const runIds = await Promise.all(pages.map((page, index) => chooseAndResume(page, frames[index],
      index ? 'Модель' : 'Алгоритм', `Контекст ${index + 1}`)));
    assert.ok(runIds.every(Boolean), 'each completed run has a URL identifier');
    assert.notEqual(runIds[0], runIds[1], 'separate contexts receive distinct run IDs');
    for (let index = 0; index < pages.length; index += 1) {
      await pages[index].reload();
      await pages[index].locator('#status').getByText('Завершено').waitFor();
      assert.equal(new URL(pages[index].url()).searchParams.get('run'), runIds[index]);
    }
  } finally {
    await Promise.all(contexts.map((context) => context.close()));
  }
});

test('offline system omits the model choice', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const frame = await beginRun(page, { system: 'offline' });
    await frame.getByText('Уточнение от модуля A').waitFor();
    await frame.getByRole('radio', { name: 'Модель', exact: true }).waitFor({ state: 'hidden' });
    await frame.getByLabel('Дополнительные данные').fill('Проверка без модели');
    await frame.getByLabel('Алгоритм').first().check();
    await frame.getByRole('button', { name: 'Продолжить' }).click();
    await page.locator('#status').getByText('Завершено').waitFor();
  } finally {
    await context.close();
  }
});

test('a pending run can be cancelled', async () => {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    await beginRun(page);
    await page.getByRole('button', { name: 'Отменить' }).click();
    await page.locator('#status').getByText('Отменено').waitFor();
  } finally {
    await context.close();
  }
});
