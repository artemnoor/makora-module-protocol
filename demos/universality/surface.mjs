export const resourceUri = "ui://universality/continue";
export const resourceMime = "text/html;profile=mcp-app";
export const appExtension = "io.modelcontextprotocol/ui";

export function panel(alternate) {
  return `<!doctype html>
<html lang="ru"><head><meta charset="utf-8">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; script-src 'unsafe-inline'; style-src 'unsafe-inline'; form-action 'none'; base-uri 'none'">
<meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  :root{font:16px system-ui;color:#172822;background:${alternate ? "#edf4fc" : "#e8f2eb"};color-scheme:light}
  body{margin:0;padding:1.15rem 1.35rem} h2{margin:0 0 .75rem;font-size:1.08rem}
  form{display:grid;gap:.55rem} input[type=text]{border:1px solid #748b82;border-radius:6px;padding:.6rem;font:inherit;min-width:0}
  fieldset{border:0;padding:0;margin:0;display:flex;flex-wrap:wrap;gap:.8rem} legend{margin-bottom:.35rem;font-weight:600}
  fieldset label{display:inline-flex;align-items:center;min-height:34px;gap:.25rem}
  button{background:#174c3a;color:white;border:0;border-radius:7px;padding:.62rem 1rem;min-height:44px;font:inherit;justify-self:start}
  :focus-visible{outline:3px solid #9a4104;outline-offset:2px} small{min-height:1.2em}
</style></head><body>
<h2>${alternate ? "Уточнение от модуля B" : "Уточнение от модуля A"}</h2>
<form>
<label for="extra">Дополнительные данные</label><input id="extra" name="extra" type="text" maxlength="500" required>
<fieldset><legend>Способ обработки</legend>
<label><input type="radio" name="choice" value="algorithm" required>Алгоритм</label>
<label data-model><input type="radio" name="choice" value="model">Модель</label></fieldset>
<button>Продолжить</button><small role="status"></small>
</form><script>
const form = document.querySelector('form');
addEventListener('message', event => {
  if (event.source !== parent || event.data?.type !== 'mmp-demo/ui-config') return;
  const option = document.querySelector('[data-model]');
  if (!event.data.allowModel) option?.remove();
});
form.addEventListener('submit', event => {
  event.preventDefault();
  const fields = new FormData(form);
  document.querySelector('small').textContent = 'Отправлено в приложение';
  parent.postMessage({type:'mmp-demo/continue', choice:fields.get('choice'), userText:fields.get('extra')}, '*');
});
</script></body></html>`;
}
