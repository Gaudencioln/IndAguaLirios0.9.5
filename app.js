
'use strict';

const APP_VERSION = 'v0.9.0';
const DB_NAME = 'agua_lirios_db_v055_v080_v081_v084_v085_v086_v087_v090';
const DB_VERSION = 8;

const APP = {
  db: null,
  lastProductionShareText: ''
};

// Banco limpo por padrão (sem seed)
let EDITING_CLIENTE_ID = null;
let EDITING_PRODUCT_ID = null;
let EDITING_INSUMO_ID = null;
let FT_STATE = [];
let INSUMOS_CACHE = [];
let SALE_SAVE_LOCK = false;
let COST_SAVE_LOCK = false;
let PURCHASE_SAVE_LOCK = false;
let RECEIVE_SAVE_LOCK = false;

const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));

function toast(msg){
  const el = $('#toast');
  if(!el){ console.log(msg); return; }
  el.textContent = msg;
  el.classList.add('is-show');
  setTimeout(()=>el.classList.remove('is-show'), 2600);
}

function parseDecimalInput(v){
  if(v===null || v===undefined) return NaN;
  const s = String(v).trim().replace(/\./g,'').replace(',','.');
  const n = Number(s);
  return Number.isFinite(n) ? n : NaN;
}

function numBR(v){
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR');
}

function moneyBR(v){
  const n = Number(v) || 0;
  return n.toLocaleString('pt-BR', {minimumFractionDigits:2, maximumFractionDigits:2});
}

function escapeHtml(s){
  return String(s ?? '')
    .replaceAll('&','&amp;')
    .replaceAll('<','&lt;')
    .replaceAll('>','&gt;')
    .replaceAll('"','&quot;')
    .replaceAll("'", '&#039;');
}

function normalizeName(s){
  return String(s || '')
    .toLowerCase()
    .normalize('NFD').replace(/[\u0300-\u036f]/g,'')
    .replace(/\s+/g,' ')
    .trim();
}

function openSection(key){
  const sectionId = key.startsWith('view-') ? key : `view-${key}`;
  $$('.view').forEach(v => v.classList.remove('is-active'));
  const target = document.getElementById(sectionId);
  if(target) target.classList.add('is-active');

  if(sectionId === 'view-compras') refreshComprasUI().catch(console.error);
  if(sectionId === 'view-custos') refreshCustosUI().catch(console.error);
  if(sectionId === 'view-producao') refreshProducaoUI().catch(console.error);
  if(sectionId === 'view-vendas') refreshVendasUI().catch(console.error);
  if(sectionId === 'view-financeiro') refreshFinanceiroUI().catch(console.error);
  if(sectionId === 'view-estoque') refreshEstoqueUI().catch(console.error);
}

function setActiveTab(tabName){
  const cad = document.getElementById('view-cadastros');
  if(!cad) return;
  cad.querySelectorAll('.tab').forEach(t => t.classList.toggle('is-active', t.dataset.tab === tabName));
  cad.querySelectorAll('.form').forEach(f => f.classList.toggle('is-active', f.dataset.form === tabName));
}

function reqToPromise(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function tx(names, mode='readonly'){
  const list = Array.isArray(names) ? names : [names];
  return APP.db.transaction(list, mode);
}

async function addRecord(storeName, data){
  const t = tx(storeName, 'readwrite');
  const id = await reqToPromise(t.objectStore(storeName).add(data));
  await new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
  return id;
}

async function putRecord(storeName, data){
  const t = tx(storeName, 'readwrite');
  await reqToPromise(t.objectStore(storeName).put(data));
  await new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

async function getById(storeName, id){
  const t = tx(storeName, 'readonly');
  return await reqToPromise(t.objectStore(storeName).get(Number(id)));
}

async function deleteById(storeName, id){
  const t = tx(storeName, 'readwrite');
  await reqToPromise(t.objectStore(storeName).delete(Number(id)));
  await new Promise((res, rej) => {
    t.oncomplete = () => res();
    t.onerror = () => rej(t.error);
    t.onabort = () => rej(t.error);
  });
}

async function listAll(storeName){
  const t = tx(storeName, 'readonly');
  return await reqToPromise(t.objectStore(storeName).getAll());
}

async function openDB(){
  return await new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      const ensure = (name) => {
        if(!db.objectStoreNames.contains(name)){
          db.createObjectStore(name, {keyPath:'id', autoIncrement:true});
        }
      };
      ensure('clientes');
      ensure('fornecedores');
      ensure('funcionarios');
      ensure('insumos');
      ensure('produtos');
      ensure('compras');
      ensure('despesas');
      ensure('centrosCusto');
      ensure('recebimentos');
      ensure('producoes');
      ensure('vendas');
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

const CENTROS_PADRAO = [
  {grupo:'Adm', subcustos:['Pro-Labore','Celulares','Internet','Combustível ADM','Alimentação ADM','Outros ADM']},
  {grupo:'20L', subcustos:['Energia','Combustível','Lab','Limpeza','Manutenção','Impostos','Químico','EPIs','Rótulos 20L','Tampas 20L','Lacres 20L','Água/Poço','Outros 20L']},
  {grupo:'500ml', subcustos:['Energia','Combustível','Lab','Marketing','Impostos','Investimentos','Garrafas PET','Tampas PET','Rótulos PET','Filme','Gás CO2','Fretes 500ml','Outros 500ml']},
  {grupo:'Leorne Plast', subcustos:['Energia','Limpeza','Manutenção','Fretes','Impostos','Matéria-prima','Moldes','Peças','Outros Plast']},
  {grupo:'Logística', subcustos:['Combustível (Rota)','Manutenção Caminhões','Documentos','Fretes','Pneus','Lubrificantes','Diárias','Outros Logística']},
  {grupo:'Sítio', subcustos:['Água Distrito','Adubo','Ração','Sementes','Fretes Sítio','Manutenção Sítio','Energia Sítio','Ferramentas Sítio','Outros Sítio']}
];

async function ensureCentrosPadrao(){
  const atuais = await listAll('centrosCusto');
  if(atuais.length) return;
  for(const c of CENTROS_PADRAO){
    for(const s of c.subcustos){
      await addRecord('centrosCusto', {grupo:c.grupo, subcusto:s, createdAt:Date.now()});
    }
  }
}


/* ---------- Clientes ---------- */
function clientesResetForm(){
  EDITING_CLIENTE_ID = null;
  const form = document.getElementById('form-clientes');
  if(form) form.reset();
  const btn = document.getElementById('btn-salvar-cliente');
  if(btn){
    btn.textContent = 'Salvar';
    btn.classList.remove('btn--update');
  }
}

async function clientesLoadToForm(clienteId){
  const cli = await getById('clientes', Number(clienteId));
  if(!cli) return toast('Cliente não encontrado.');
  EDITING_CLIENTE_ID = Number(cli.id);
  const form = document.getElementById('form-clientes');
  if(!form) return;
  form.querySelector('[name="nome"]').value = cli.nome || '';
  form.querySelector('[name="telefone"]').value = cli.telefone || '';
  form.querySelector('[name="cidade"]').value = cli.cidade || '';
  const lim = Number(cli.limiteCredito || 0);
  const limField = form.querySelector('[name="limiteCredito"]');
  if(limField) limField.value = lim ? moneyBR(lim) : '';
  const btn = document.getElementById('btn-salvar-cliente');
  if(btn){
    btn.textContent = 'Atualizar Cliente';
    btn.classList.add('btn--update');
  }
}

function limitesListFormatter(r){
  const limite = Number(r.limiteCredito || 0);
  const devedor = Number(r.saldoDevedor || 0);
  const disponivel = Math.max(0, limite - devedor);
  return `
    <tr>
      <td><strong>${escapeHtml(r.nome || '')}</strong></td>
      <td>R$ ${escapeHtml(moneyBR(devedor))}</td>
      <td>R$ ${escapeHtml(moneyBR(disponivel))}</td>
      <td><input class="field__input limite-input js-limite-input" type="number" step="0.01" data-id="${r.id}" value="${limite}" /></td>
      <td><button class="btn js-save-limite" type="button" data-id="${r.id}">Salvar</button></td>
    </tr>
  `;
}

async function refreshLimitesUI(){
  await handleList('limites');
}

/* ---------- Renderers ---------- */
function produtosListFormatter(p){
  const pv = moneyBR(p.precoVenda || 0);
  const ftCount = Array.isArray(p.fichaTecnica) ? p.fichaTecnica.length : 0;
  return `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(p.nome || '')}</div>
        <div class="item__meta">Unid: ${escapeHtml(p.unidade || '')} • Preço Venda: R$ ${escapeHtml(pv)} • Receita: ${ftCount} itens</div>
      </div>
      <div class="item__right">
        <button class="btn js-prod-edit" type="button" data-id="${p.id}">Editar</button><br/>
        <button class="btn btn--ghost js-prod-del" type="button" data-id="${p.id}">Excluir</button>
      </div>
    </div>
  `;
}

function insumosListFormatter(i){
  return `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(i.nome || '')}</div>
        <div class="item__meta">Unid: ${escapeHtml(i.unidade || '')} • Custo Médio (Unit): R$ ${escapeHtml(moneyBR(i.custoUnit || 0))}</div>
      </div>
      <div class="item__right">
        Saldo: ${escapeHtml(numBR(i.saldo || 0))}
        <div style="margin-top:6px">
          <button class="btn js-ins-edit" type="button" data-id="${i.id}">Editar</button>
          <button class="btn btn--ghost js-ins-del" type="button" data-id="${i.id}">Excluir</button>
        </div>
      </div>
    </div>
  `;
}

function simpleFormatter(titleKey, metaBuilder){
  return (row) => `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(row[titleKey] || '')}</div>
        <div class="item__meta">${escapeHtml(metaBuilder(row))}</div>
      </div>
      <div class="item__right">#${row.id}</div>
    </div>
  `;
}

async function handleList(entity){
  const map = {
    clientes: ['list-clientes', (r)=>`<div class="item"><div><div class="item__title">${escapeHtml(r.nome||'')}</div><div class="item__meta">${escapeHtml([r.telefone,r.cidade].filter(Boolean).join(' • '))} • Limite: R$ ${escapeHtml(moneyBR(r.limiteCredito||0))} • Devedor: R$ ${escapeHtml(moneyBR(r.saldoDevedor||0))}</div></div><div class="item__right"><button class="btn js-cli-edit" type="button" data-id="${r.id}">Editar</button></div></div>`],
    fornecedores: ['list-fornecedores', simpleFormatter('nome', r => r.contato || '')],
    funcionarios: ['list-funcionarios', simpleFormatter('nome', r => r.funcao || '')],
    insumos: ['list-insumos', insumosListFormatter],
    produtos: ['list-produtos', produtosListFormatter],
    centrosCusto: ['list-centros', (r)=>`<div class="item"><div><div class="item__title">${escapeHtml(r.grupo||'')}</div><div class="item__meta">Subcusto: ${escapeHtml(r.subcusto||'')} • Obs: ${escapeHtml(r.observacao||'')}</div></div><div class="item__right list-actions"><button class="btn js-centro-edit" type="button" data-id="${r.id}">Editar</button></div></div>`],
    limites: ['list-limites', limitesListFormatter]
  };
  const hit = map[entity];
  if(!hit) return;
  const [listId, formatter] = hit;
  const box = document.getElementById(listId);
  if(!box) return;
  const sourceEntity = entity === 'limites' ? 'clientes' : entity;
  const items = await listAll(sourceEntity);
  items.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  box.innerHTML = items.length ? items.map(formatter).join('') : `<div class="muted">Nenhum registro.</div>`;
  if(entity === 'produtos'){
    const countLabel = document.createElement('div');
    countLabel.className = 'muted';
    countLabel.style.marginTop = '8px';
    countLabel.textContent = `Listagem: produtos (${items.length})`;
    box.appendChild(countLabel);
  }
}

/* ---------- Ficha Técnica ---------- */
async function loadInsumosCache(){
  INSUMOS_CACHE = await listAll('insumos');
  INSUMOS_CACHE.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  return INSUMOS_CACHE;
}

function insumosOptionsHtml(){
  return INSUMOS_CACHE.map(i => `<option value="${i.id}">${escapeHtml(i.nome)} • ${escapeHtml(i.unidade || '')}</option>`).join('');
}

function ftRender(){
  const box = document.getElementById('ft-itens');
  if(!box) return;
  if(!FT_STATE.length){
    box.innerHTML = '<div class="muted">Ficha vazia (sem baixa automática).</div>';
    return;
  }
  const opts = insumosOptionsHtml();
  box.innerHTML = FT_STATE.map((it, ix) => `
    <div class="item">
      <div style="width:100%">
        <div class="ftrow" data-ft-row="${ix}">
          <select class="field__input" data-ft-insumo>
            <option value="">Selecione insumo...</option>
            ${opts}
          </select>
          <input class="field__input" data-ft-qtd inputmode="decimal" placeholder="Qtd" value="${escapeHtml(it.qtd ?? '')}"/>
          <input class="field__input" data-ft-unit placeholder="Unid" value="${escapeHtml(it.unidade ?? '')}"/>
          <button class="btn btn--ghost" type="button" data-action="remove-ft-item" data-ix="${ix}">Remover</button>
        </div>
      </div>
    </div>
  `).join('');
  const rows = Array.from(box.querySelectorAll('[data-ft-row]'));
  rows.forEach((r, ix) => {
    const sel = r.querySelector('[data-ft-insumo]');
    if(sel) sel.value = String(FT_STATE[ix].insumoId || '');
  });
}

function ftClear(){
  FT_STATE = [];
  ftRender();
}

async function ftAddRow(){
  await loadInsumosCache();
  FT_STATE.push({insumoId:'', insumoNome:'', qtd:'', unidade:''});
  ftRender();
}

function ftSyncFromUI(){
  const box = document.getElementById('ft-itens');
  if(!box) return [];
  const rows = Array.from(box.querySelectorAll('[data-ft-row]'));
  const out = [];
  for(const r of rows){
    const insId = r.querySelector('[data-ft-insumo]')?.value || '';
    const qtd = parseDecimalInput(r.querySelector('[data-ft-qtd]')?.value || '');
    let unit = String(r.querySelector('[data-ft-unit]')?.value || '').trim();
    if(!insId) continue;
    if(!Number.isFinite(qtd) || qtd <= 0) continue;
    const ins = INSUMOS_CACHE.find(x => String(x.id) === String(insId));
    if(!unit) unit = ins?.unidade || '';
    out.push({
      insumoId: Number(insId),
      insumoNome: ins?.nome || '',
      qtd: Number(qtd),
      unidade: unit
    });
  }
  FT_STATE = out;
  return out;
}

/* ---------- Produtos ---------- */
function produtosSetModo(modo){
  const el = document.getElementById('produtos-modo');
  if(el) el.textContent = modo;
  const btn = document.querySelector('#form-produtos button[type="submit"]');
  if(btn){
    if(String(modo || '').toLowerCase().startsWith('editando')){
      btn.textContent = 'ATUALIZAR PRODUTO';
      btn.classList.add('btn--update');
    }else{
      btn.textContent = 'Salvar Produto';
      btn.classList.remove('btn--update');
    }
  }
}

function produtosResetForm(){
  EDITING_PRODUCT_ID = null;
  const idEl = document.getElementById('produto-id');
  const nomeEl = document.getElementById('produto-nome');
  const unEl = document.getElementById('produto-unidade');
  const pvEl = document.getElementById('produto-precoVenda');
  if(idEl) idEl.value = '';
  if(nomeEl) nomeEl.value = '';
  if(unEl) unEl.value = '';
  if(pvEl) pvEl.value = '';
  FT_STATE = [];
  ftRender();
  produtosSetModo('Novo');
}

async function produtosLoadToForm(produtoId){
  const p = await getById('produtos', Number(produtoId));
  if(!p) return toast('Produto não encontrado.');

  const idEl = document.getElementById('produto-id');
  const nomeEl = document.getElementById('produto-nome');
  const unEl = document.getElementById('produto-unidade');
  const pvEl = document.getElementById('produto-precoVenda');
  if(!idEl || !nomeEl || !unEl || !pvEl){
    console.error('IDs do formulário de produto não encontrados.');
    toast('Campos do formulário não encontrados.');
    return;
  }

  EDITING_PRODUCT_ID = Number(p.id);
  idEl.value = String(p.id);
  nomeEl.value = p.nome || '';
  unEl.value = p.unidade || '';
  pvEl.value = moneyBR(p.precoVenda || 0);

  await loadInsumosCache();
  const ft = Array.isArray(p.fichaTecnica) ? p.fichaTecnica : [];
  FT_STATE = ft.map(line => {
    const name = String(line.insumoNome || '').trim();
    const guess = INSUMOS_CACHE.find(i => normalizeName(i.nome) === normalizeName(name));
    return {
      insumoId: line.insumoId || guess?.id || '',
      insumoNome: name,
      qtd: Number(line.qtd) || 0,
      unidade: line.unidade || guess?.unidade || ''
    };
  });
  ftRender();
  produtosSetModo(`Editando #${p.id}`);
}

async function produtosDelete(produtoId){
  if(!confirm('Excluir este produto?')) return;
  await deleteById('produtos', Number(produtoId));
  toast('Produto excluído.');
  if(EDITING_PRODUCT_ID === Number(produtoId)) produtosResetForm();
  await handleList('produtos');
  await refreshProdutosSelect();
}

/* ---------- Insumos ---------- */
function insumosResetForm(){
  EDITING_INSUMO_ID = null;
  const form = document.getElementById('form-insumos');
  if(form) form.reset();
  const btn = document.querySelector('#form-insumos button[type="submit"]');
  if(btn){
    btn.textContent = 'Salvar';
    btn.classList.remove('btn--update');
  }
}

async function insumosLoadToForm(insumoId){
  const ins = await getById('insumos', Number(insumoId));
  if(!ins) return toast('Insumo não encontrado.');
  EDITING_INSUMO_ID = Number(ins.id);
  const form = document.getElementById('form-insumos');
  if(!form) return toast('Formulário de insumos não encontrado.');
  form.querySelector('[name="nome"]').value = ins.nome || '';
  form.querySelector('[name="unidade"]').value = ins.unidade || '';
  form.querySelector('[name="saldo"]').value = numBR(ins.saldo || 0);
  form.querySelector('[name="custoUnit"]').value = moneyBR(ins.custoUnit || 0);
  const btn = form.querySelector('button[type="submit"]');
  if(btn){
    btn.textContent = 'Atualizar Insumo';
    btn.classList.add('btn--update');
  }
}

async function insumosDelete(insumoId){
  if(!confirm('Excluir este insumo?')) return;
  await deleteById('insumos', Number(insumoId));
  toast('Insumo excluído.');
  if(EDITING_INSUMO_ID === Number(insumoId)) insumosResetForm();
  await handleList('insumos');
  await refreshComprasUI();
  await refreshEstoqueUI();
}




function limitesListFormatter(r){
  const limite = Number(r.limiteCredito || 0);
  const devedor = Number(r.saldoDevedor || 0);
  const disponivel = Math.max(0, limite - devedor);
  return `
    <div class="item">
      <div class="limit-row">
        <div>
          <div class="item__title">${escapeHtml(r.nome || '')}</div>
          <div class="item__meta limit-meta">Saldo Devedor: R$ ${escapeHtml(moneyBR(devedor))} • Crédito Disponível: R$ ${escapeHtml(moneyBR(disponivel))}</div>
        </div>
        <input class="field__input js-limite-input" data-id="${r.id}" inputmode="decimal" placeholder="Limite (R$)" value="${escapeHtml(moneyBR(limite))}" />
        <button class="btn js-save-limite" type="button" data-id="${r.id}">Salvar Limite</button>
      </div>
    </div>
  `;
}

async function refreshLimitesUI(){
  await handleList('limites');
}

/* ---------- Compras / Custos ---------- */
async function fillComprasSelect(){
  const sel = document.getElementById('compra-insumo');
  if(!sel) return;
  const insumos = await listAll('insumos');
  insumos.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  sel.innerHTML = '<option value="">Selecione...</option>' + insumos.map(i => `<option value="${i.id}">${escapeHtml(i.nome)} • ${escapeHtml(i.unidade||'')} • Custo: R$ ${escapeHtml(moneyBR(i.custoUnit||0))}</option>`).join('');
}

async function listarCompras(){
  const box = document.getElementById('list-compras');
  if(!box) return;
  const items = await listAll('compras');
  items.sort((a,b)=>(b.data||0) - (a.data||0));
  const last = items.slice(0,10);
  box.innerHTML = last.length ? last.map(c => `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(c.insumoNome || '')} • +${escapeHtml(numBR(c.qtd || 0))} ${escapeHtml(c.unidade || '')}</div>
        <div class="item__meta">${new Date(c.data||Date.now()).toLocaleString('pt-BR')} • Total: R$ ${escapeHtml(moneyBR(c.precoTotal || 0))}</div>
      </div>
      <div class="item__right">CustoUnit: R$ ${escapeHtml(moneyBR(c.custoUnitNovo || 0))}</div>
    </div>
  `).join('') : '<div class="muted">Nenhuma compra registrada.</div>';
}

async function fillDespesaGrupos(){
  const sel = document.getElementById('despesa-grupo');
  if(!sel) return;
  const centros = await listAll('centrosCusto');
  const grupos = [...new Set(centros.map(c => c.grupo).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b), 'pt-BR'));
  sel.innerHTML = '<option value="">Selecione...</option>' + grupos.map(g => `<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
}

async function fillDespesaSubcustos(grupo){
  const sel = document.getElementById('despesa-subcusto');
  if(!sel) return;
  if(!grupo){
    sel.innerHTML = '<option value="">Selecione o grupo primeiro...</option>';
    sel.value = '';
    return;
  }
  const centros = await listAll('centrosCusto');
  const subs = centros
    .filter(c => String(c.grupo || '').trim() === String(grupo || '').trim())
    .map(c => c.subcusto)
    .filter(Boolean)
    .sort((a,b)=>String(a).localeCompare(String(b), 'pt-BR'));

  sel.innerHTML = '<option value="">Selecione...</option>' + subs.map(s => `<option value="${escapeHtml(s)}">${escapeHtml(s)}</option>`).join('');
  sel.value = '';
}

function despesasListFormatter(d){
  return `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(d.grupo || '')} • ${escapeHtml(d.subcusto || '')}</div>
        <div class="item__meta">${new Date(d.data||Date.now()).toLocaleString('pt-BR')} • ${escapeHtml(d.formaPagamento || '')}</div>
      </div>
      <div class="item__right">R$ ${escapeHtml(moneyBR(d.valor || 0))}</div>
    </div>
  `;
}

async function listarDespesas(){
  const box = document.getElementById('list-despesas');
  if(!box) return;
  const items = await listAll('despesas');
  items.sort((a,b)=>(b.data||0) - (a.data||0));
  box.innerHTML = items.length ? items.slice(0,20).map(despesasListFormatter).join('') : '<div class="muted">Nenhuma despesa registrada.</div>';
}

async function listarCustosItens(){
  const box = document.getElementById('list-custos-itens');
  if(!box) return;
  const itens = await listAll('centrosCusto');
  itens.sort((a,b)=> (String(a.grupo||'')+String(a.subcusto||'')).localeCompare(String(b.grupo||'')+String(b.subcusto||''), 'pt-BR'));
  box.innerHTML = itens.length ? itens.map(r => `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(r.grupo || '')} • ${escapeHtml(r.subcusto || '')}</div>
        <div class="item__meta">Obs: ${escapeHtml(r.observacao || '')}</div>
      </div>
      <div class="item__right list-actions"><button class="btn js-centro-edit" type="button" data-id="${r.id}">Editar</button></div>
    </div>
  `).join('') : '<div class="muted">Nenhum subcusto cadastrado.</div>';
}

async function refreshComprasUI(){
  await fillComprasSelect();
  await listarCompras();
}

async function refreshCustosUI(){
  await fillDespesaGrupos();
  await fillDespesaSubcustos(document.getElementById('despesa-grupo')?.value || '');
  await listarDespesas();
  await listarCustosItens();
}

async function registrarCompra(insumoId, qtdComprada, precoTotalPago){
  const ins = await getById('insumos', Number(insumoId));
  if(!ins) return {ok:false, msg:'Insumo não encontrado.'};
  const saldoAtual = Number(ins.saldo) || 0;
  const custoAtual = Number(ins.custoUnit) || 0;
  const qtdNova = saldoAtual + qtdComprada;
  if(qtdNova <= 0) return {ok:false, msg:'Quantidade total inválida.'};
  const novoCusto = ((saldoAtual * custoAtual) + precoTotalPago) / qtdNova;
  ins.saldo = Number(qtdNova.toFixed(6));
  ins.custoUnit = Number(novoCusto.toFixed(6));
  await putRecord('insumos', ins);
  await addRecord('compras', {
    data: Date.now(),
    insumoId: ins.id,
    insumoNome: ins.nome,
    unidade: ins.unidade,
    qtd: Number(qtdComprada.toFixed(6)),
    precoTotal: Number(precoTotalPago.toFixed(6)),
    saldoAntes: saldoAtual,
    saldoDepois: ins.saldo,
    custoUnitAntes: custoAtual,
    custoUnitNovo: ins.custoUnit
  });
  return {ok:true, msg:`Compra registrada. Novo custoUnit: R$ ${moneyBR(ins.custoUnit)}`};
}

async function registrarDespesa(grupo, subcusto, valor, formaPagamento){
  await addRecord('despesas', {data:Date.now(), grupo, subcusto, valor:Number(valor.toFixed(6)), formaPagamento});
  return {ok:true, msg:'Despesa registrada com sucesso.'};
}



/* ---------- Vendas / Financeiro ---------- */
function vendasListFormatter(v){
  const total = Number(v.totalVenda ?? (Number(v.qtd || 0) * Number(v.precoUnit || 0)));
  return `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(v.produtoNome || '')} • ${escapeHtml(numBR(v.qtd || 0))} ${escapeHtml(v.unidade || '')}</div>
        <div class="item__meta">${escapeHtml(v.clienteNome || '')} • ${new Date(v.data || Date.now()).toLocaleString('pt-BR')} • Din: R$ ${escapeHtml(moneyBR(v.valorDinheiro || 0))} • Pix: R$ ${escapeHtml(moneyBR(v.valorPix || 0))} • Vale: R$ ${escapeHtml(moneyBR(v.valorVale || 0))}</div>
      </div>
      <div class="item__right">Total: R$ ${escapeHtml(moneyBR(total))}</div>
    </div>
  `;
}

function recebimentosListFormatter(r){
  return `
    <div class="item">
      <div>
        <div class="item__title">Recebimento de Vale • ${escapeHtml(r.clienteNome || '')}</div>
        <div class="item__meta">${new Date(r.data || Date.now()).toLocaleString('pt-BR')} • ${escapeHtml(r.formaPagamento || '')}</div>
      </div>
      <div class="item__right">R$ ${escapeHtml(moneyBR(r.valor || 0))}</div>
    </div>
  `;
}

async function fillClientesSelect(){
  const sel = document.getElementById('venda-cliente');
  if(!sel) return;
  const clientes = await listAll('clientes');
  clientes.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  sel.innerHTML = '<option value="">Selecione...</option>' + clientes.map(c => `<option value="${c.id}">${escapeHtml(c.nome || '')}</option>`).join('');
}

async function fillRecebClientesSelect(){
  const sel = document.getElementById('receb-cliente');
  if(!sel) return;
  const clientes = await listAll('clientes');
  clientes.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  sel.innerHTML = '<option value="">Selecione...</option>' + clientes.map(c => `<option value="${c.id}">${escapeHtml(c.nome || '')}</option>`).join('');
}

async function fillVendaProdutosSelect(){
  const sel = document.getElementById('venda-produto');
  if(!sel) return;
  const produtos = await listAll('produtos');
  produtos.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  sel.innerHTML = '<option value="">Selecione...</option>' + produtos.map(p => `<option value="${p.id}">${escapeHtml(p.nome || '')} • Saldo: ${escapeHtml(numBR(p.saldo || 0))} ${escapeHtml(p.unidade || 'un')}</option>`).join('');
}

async function updateVendaClienteInfo(){
  const box = document.getElementById('venda-cliente-financeiro');
  const sel = document.getElementById('venda-cliente');
  if(!box || !sel) return;
  const id = Number(sel.value || 0);
  if(!id){
    box.textContent = 'Selecione um cliente para ver crédito e saldo devedor.';
    return;
  }
  const cliente = await getById('clientes', id);
  if(!cliente){
    box.textContent = 'Cliente não encontrado.';
    return;
  }
  const limite = Number(cliente.limiteCredito || 0);
  const devedor = Number(cliente.saldoDevedor || 0);
  const disponivel = Math.max(0, limite - devedor);
  box.innerHTML = `Limite de Crédito: <b>R$ ${escapeHtml(moneyBR(limite))}</b> • Saldo Devedor: <b>R$ ${escapeHtml(moneyBR(devedor))}</b> • Disponível: <b>R$ ${escapeHtml(moneyBR(disponivel))}</b>`;
}

function updateVendaPreview(){
  const qtd = parseDecimalInput($('#venda-qtd')?.value || '0');
  const preco = parseDecimalInput($('#venda-preco')?.value || '0');
  const din = parseDecimalInput($('#venda-dinheiro')?.value || '0');
  const pix = parseDecimalInput($('#venda-pix')?.value || '0');
  const vale = parseDecimalInput($('#venda-vale')?.value || '0');
  const total = (Number.isFinite(qtd) ? qtd : 0) * (Number.isFinite(preco) ? preco : 0);
  const pagamentos = (Number.isFinite(din) ? din : 0) + (Number.isFinite(pix) ? pix : 0) + (Number.isFinite(vale) ? vale : 0);
  const box = $('#venda-total-previa');
  if(box) box.textContent = `Total da venda: R$ ${moneyBR(total)} • Pagamentos informados: R$ ${moneyBR(pagamentos)}`;
}

async function updateRecebClienteInfo(){
  const box = $('#receb-cliente-info');
  const id = Number($('#receb-cliente')?.value || 0);
  if(!box) return;
  if(!id){
    box.textContent = 'Selecione um cliente para visualizar o saldo devedor.';
    return;
  }
  const cliente = await getById('clientes', id);
  if(!cliente){
    box.textContent = 'Cliente não encontrado.';
    return;
  }
  box.innerHTML = `Saldo Devedor Atual: <b>R$ ${escapeHtml(moneyBR(cliente.saldoDevedor || 0))}</b>`;
}

async function listarVendas(){
  const box = document.getElementById('list-vendas');
  if(!box) return;
  const vendas = await listAll('vendas');
  vendas.sort((a,b)=>(b.data||0) - (a.data||0));
  box.innerHTML = vendas.length ? vendas.slice(0,30).map(vendasListFormatter).join('') : '<div class="muted">Nenhuma venda registrada.</div>';
}

async function refreshVendasUI(){
  await fillClientesSelect();
  await fillVendaProdutosSelect();
  await updateVendaClienteInfo();
  updateVendaPreview();
  await listarVendas();
}

async function refreshFinanceiroUI(){
  const vendas = await listAll('vendas');
  const despesas = await listAll('despesas');
  const recebimentos = await listAll('recebimentos');

  vendas.sort((a,b)=>(b.data||0) - (a.data||0));
  recebimentos.sort((a,b)=>(b.data||0) - (a.data||0));

  let totalDinheiro = 0, totalPix = 0, totalVale = 0;
  for(const v of vendas){
    totalDinheiro += Number(v.valorDinheiro || 0);
    totalPix += Number(v.valorPix || 0);
    totalVale += Number(v.valorVale || 0);
  }
  for(const r of recebimentos){
    if(r.formaPagamento === 'Dinheiro') totalDinheiro += Number(r.valor || 0);
    else if(r.formaPagamento === 'Pix') totalPix += Number(r.valor || 0);
  }

  const resumo = document.getElementById('financeiro-resumo');
  if(resumo){
    resumo.innerHTML = `
      <div class="item"><div class="item__title financeiro-total">Total em Dinheiro</div><div class="item__right">R$ ${escapeHtml(moneyBR(totalDinheiro))}</div></div>
      <div class="item"><div class="item__title financeiro-total">Total em Pix</div><div class="item__right">R$ ${escapeHtml(moneyBR(totalPix))}</div></div>
      <div class="item"><div class="item__title financeiro-total">Total em Vales</div><div class="item__right">R$ ${escapeHtml(moneyBR(totalVale))}</div></div>
    `;
  }

  const lista = document.getElementById('financeiro-vendas');
  if(lista){
    const historico = [
      ...vendas.map(v => ({data:v.data || 0, html:vendasListFormatter(v)})),
      ...recebimentos.map(r => ({data:r.data || 0, html:recebimentosListFormatter(r)}))
    ].sort((a,b)=>b.data-a.data);
    lista.innerHTML = historico.length ? historico.slice(0,50).map(x=>x.html).join('') : '<div class="muted">Nenhum lançamento financeiro.</div>';
  }

  const filtro = document.getElementById('financeiro-centro-filtro');
  const out = document.getElementById('financeiro-despesas-resumo');
  const grupos = [...new Set(despesas.map(d=>d.grupo).filter(Boolean))].sort((a,b)=>String(a).localeCompare(String(b),'pt-BR'));

  if(filtro){
    const cur = filtro.value || '';
    filtro.innerHTML = '<option value="">Todos</option>' + grupos.map(g=>`<option value="${escapeHtml(g)}">${escapeHtml(g)}</option>`).join('');
    filtro.value = grupos.includes(cur) ? cur : '';
    const grupoSel = filtro.value || '';
    const filtradas = grupoSel ? despesas.filter(d=>String(d.grupo||'')===String(grupoSel)) : despesas;
    const totalGastos = filtradas.reduce((s,d)=>s + Number(d.valor||0), 0);
    if(out){
      out.innerHTML = `
        <div class="item"><div class="item__title">Centro Selecionado</div><div class="item__right">${escapeHtml(grupoSel || 'Todos')}</div></div>
        <div class="item"><div class="item__title">Total de Gastos</div><div class="item__right">R$ ${escapeHtml(moneyBR(totalGastos))}</div></div>
      ` + (filtradas.length ? filtradas.sort((a,b)=>(b.data||0)-(a.data||0)).slice(0,30).map(despesasListFormatter).join('') : '<div class="muted">Nenhuma despesa para este filtro.</div>');
    }
  }

  await fillRecebClientesSelect();
  await updateRecebClienteInfo();
}

async function registrarVenda(clienteId, produtoId, qtd, precoUnit, valorDinheiro, valorPix, valorVale){
  const cliente = await getById('clientes', Number(clienteId));
  if(!cliente) return {ok:false, msg:'Cliente não encontrado.'};
  const produto = await getById('produtos', Number(produtoId));
  if(!produto) return {ok:false, msg:'Produto não encontrado.'};

  const saldoAtual = Number(produto.saldo || 0);
  if(saldoAtual + 1e-9 < qtd){
    return {ok:false, msg:`Saldo insuficiente para venda. Disponível: ${numBR(saldoAtual)} ${produto.unidade || 'un'}`};
  }

  const totalVenda = Number((qtd * precoUnit).toFixed(6));
  const somaPagamentos = Number((valorDinheiro + valorPix + valorVale).toFixed(6));
  if(Math.abs(totalVenda - somaPagamentos) > 0.009){
    return {ok:false, msg:`Os pagamentos não fecham a venda. Total: R$ ${moneyBR(totalVenda)} | Informado: R$ ${moneyBR(somaPagamentos)}`};
  }

  const limite = Number(cliente.limiteCredito || 0);
  const saldoDevedor = Number(cliente.saldoDevedor || 0);
  if(valorVale > 0){
    const novoSaldoDevedor = saldoDevedor + valorVale;
    if(limite > 0 && novoSaldoDevedor - limite > 1e-9){
      return {ok:false, msg:`Limite insuficiente! Disponível: R$ ${moneyBR(Math.max(0, limite - saldoDevedor))}`};
    }
    cliente.saldoDevedor = Number(novoSaldoDevedor.toFixed(6));
    await putRecord('clientes', cliente);
  }

  produto.saldo = Number((saldoAtual - qtd).toFixed(6));
  await putRecord('produtos', produto);

  const formaResumo = (valorVale > 0 && (valorDinheiro > 0 || valorPix > 0)) ? 'Misto' : (valorVale > 0 ? 'Vale' : (valorPix > 0 && valorDinheiro > 0 ? 'Misto' : (valorPix > 0 ? 'Pix' : 'Dinheiro')));

  await addRecord('vendas', {
    data: Date.now(),
    clienteId: cliente.id,
    clienteNome: cliente.nome,
    produtoId: produto.id,
    produtoNome: produto.nome,
    unidade: produto.unidade || 'un',
    qtd: Number(qtd.toFixed(6)),
    precoUnit: Number(precoUnit.toFixed(6)),
    totalVenda,
    valorDinheiro: Number(valorDinheiro.toFixed(6)),
    valorPix: Number(valorPix.toFixed(6)),
    valorVale: Number(valorVale.toFixed(6)),
    formaPagamento: formaResumo
  });

  return {ok:true, msg:'Venda registrada com sucesso.'};
}

async function registrarRecebimentoVale(clienteId, valor, formaPagamento){
  const cliente = await getById('clientes', Number(clienteId));
  if(!cliente) return {ok:false, msg:'Cliente não encontrado.'};
  const saldoDevedor = Number(cliente.saldoDevedor || 0);
  if(!Number.isFinite(valor) || valor <= 0) return {ok:false, msg:'Valor inválido.'};
  if(valor - saldoDevedor > 1e-9) return {ok:false, msg:`Valor maior que o saldo devedor atual (R$ ${moneyBR(saldoDevedor)}).`};

  cliente.saldoDevedor = Number((saldoDevedor - valor).toFixed(6));
  await putRecord('clientes', cliente);

  await addRecord('recebimentos', {
    data: Date.now(),
    clienteId: cliente.id,
    clienteNome: cliente.nome,
    valor: Number(valor.toFixed(6)),
    formaPagamento
  });

  return {ok:true, msg:'Recebimento registrado com sucesso.'};
}

/* ---------- Produção ---------- */


async function refreshProdutosSelect(){
  const sel = document.getElementById('producao-produto');
  if(!sel) return;
  const produtos = await listAll('produtos');
  produtos.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  sel.innerHTML = '<option value="">Selecione...</option>' + produtos.map(p => `<option value="${p.id}">${escapeHtml(p.nome)} • Saldo: ${escapeHtml(numBR(p.saldo || 0))} ${escapeHtml(p.unidade || 'un')}</option>`).join('');
}

async function updateFichaPreview(){
  const sel = document.getElementById('producao-produto');
  const box = document.getElementById('producao-ficha');
  if(!sel || !box) return;

  const pid = Number(sel.value || 0);
  if(!pid){
    box.innerHTML = '<div class="muted">Selecione um produto para ver a ficha técnica.</div>';
    return;
  }

  const p = await getById('produtos', pid);
  if(!p){
    box.innerHTML = '<div class="muted">Produto não encontrado.</div>';
    return;
  }

  const ft = Array.isArray(p.fichaTecnica) ? p.fichaTecnica : [];
  if(!ft.length){
    box.innerHTML = '<div class="muted">Produto sem ficha técnica (sem baixa automática).</div>';
    return;
  }

  box.innerHTML = ft.map((it) => `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(it.insumoNome || '')}</div>
        <div class="item__meta">${escapeHtml(numBR(it.qtd || 0))} ${escapeHtml(it.unidade || '')}</div>
      </div>
      <div class="item__right">por 1 un</div>
    </div>
  `).join('');
}

async function listarProducoes(){
  const box = document.getElementById('list-producoes');
  if(!box) return;
  const items = await listAll('producoes');
  items.sort((a,b)=>(b.data||0) - (a.data||0));
  box.innerHTML = items.slice(0,30).map(r => `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(r.produtoNome || '')} • ${escapeHtml(numBR(r.qtd || 0))} ${escapeHtml(r.unidade || 'un')}</div>
        <div class="item__meta">${new Date(r.data||Date.now()).toLocaleString('pt-BR')}</div>
      </div>
      <div class="item__right">#${r.id}</div>
    </div>
  `).join('') || '<div class="muted">Nenhuma produção registrada.</div>';
}

async function refreshProducaoUI(){
  await refreshProdutosSelect();
  await updateFichaPreview();
  await listarProducoes();
  hideShareButton();
}

function showShareButton(){ $('#btn-share-producao')?.classList.remove('is-hidden'); }
function hideShareButton(){ $('#btn-share-producao')?.classList.add('is-hidden'); }

async function precheckEstoque(produtoId, qtdProduzida){
  const produto = await getById('produtos', Number(produtoId));
  if(!produto) return {ok:false, msg:'Produto não encontrado.'};

  const needs = (Array.isArray(produto.fichaTecnica) ? produto.fichaTecnica : []).map(line => ({
    insumoId: line.insumoId,
    insumoNome: line.insumoNome,
    unidade: line.unidade,
    qtdNecessaria: (Number(line.qtd)||0) * qtdProduzida
  }));

  const insumos = await listAll('insumos');
  const faltas = [];
  for(const n of needs){
    let ins = null;
    if(n.insumoId) ins = insumos.find(i => Number(i.id) === Number(n.insumoId)) || null;
    if(!ins) ins = insumos.find(i => normalizeName(i.nome) === normalizeName(n.insumoNome)) || null;
    if(!ins){
      faltas.push({nome:n.insumoNome, motivo:'Insumo não cadastrado', necessario:n.qtdNecessaria, saldo:0, unidade:n.unidade});
      continue;
    }
    const saldo = Number(ins.saldo)||0;
    if(saldo + 1e-9 < n.qtdNecessaria){
      faltas.push({nome:ins.nome, motivo:'Saldo insuficiente', necessario:n.qtdNecessaria, saldo, unidade:ins.unidade || n.unidade});
    }
  }

  if(faltas.length){
    const lines = faltas.map(f => `• ${f.nome}: ${f.motivo} (Precisa ${numBR(f.necessario)} ${f.unidade} | Tem ${numBR(f.saldo)} ${f.unidade})`).join('\n');
    return {ok:false, msg:'Produção bloqueada.\n' + lines};
  }
  return {ok:true, msg:'Estoque OK para produzir.'};
}

async function registrarProducao(){
  const produtoId = Number($('#producao-produto')?.value || 0);
  const qtd = parseDecimalInput($('#producao-qtd')?.value || '');

  if(!produtoId) return toast('Selecione um produto.');
  if(!Number.isFinite(qtd) || qtd <= 0) return toast('Quantidade inválida.');

  const produto = await getById('produtos', produtoId);
  if(!produto) return toast('Produto não encontrado.');

  if(!Number.isFinite(Number(produto.saldo))) produto.saldo = 0;

  const ficha = Array.isArray(produto.fichaTecnica) ? produto.fichaTecnica : [];

  if(!ficha.length){
    produto.saldo = Number((Number(produto.saldo || 0) + qtd).toFixed(6));
    await putRecord('produtos', produto);

    await addRecord('producoes', {
      data: Date.now(),
      produtoId: produto.id,
      produtoNome: produto.nome,
      qtd,
      unidade: produto.unidade || 'un',
      baixas: []
    });

    APP.lastProductionShareText = `Relatório de Produção - Água Lírios: Produzido ${qtd} de ${produto.nome}. Insumos consumidos com sucesso.`;
    showShareButton();
    toast('Produção registrada (sem baixa automática).');
    $('#producao-qtd').value = '';
    await refreshProducaoUI();
    await refreshEstoqueUI();
    return;
  }

  const insumos = await listAll('insumos');
  const baixas = [];
  const faltas = [];

  for(const item of ficha){
    const qtdPorUn = Number(item.qtd) || 0;
    if(qtdPorUn <= 0) continue;

    let ins = null;
    if(item.insumoId){
      ins = insumos.find(x => Number(x.id) === Number(item.insumoId)) || null;
    }
    if(!ins){
      ins = insumos.find(x => normalizeName(x.nome) === normalizeName(item.insumoNome)) || null;
    }

    if(!ins){
      faltas.push({
        nome: item.insumoNome || 'Insumo',
        motivo: 'Insumo não cadastrado',
        necessario: qtd * qtdPorUn,
        saldo: 0,
        unidade: item.unidade || ''
      });
      continue;
    }

    const consumo = Number((qtd * qtdPorUn).toFixed(6));
    const saldoAtual = Number(ins.saldo || 0);

    if(saldoAtual + 1e-9 < consumo){
      faltas.push({
        nome: ins.nome,
        motivo: 'Saldo insuficiente',
        necessario: consumo,
        saldo: saldoAtual,
        unidade: ins.unidade || item.unidade || ''
      });
      continue;
    }

    baixas.push({
      insumoId: ins.id,
      insumoNome: ins.nome,
      consumo,
      unidade: ins.unidade || item.unidade || ''
    });
  }

  if(faltas.length){
    const msg = `Produção bloqueada.\n${faltas.map(f =>
      `• ${f.nome}: ${f.motivo} (Precisa ${numBR(f.necessario)} ${f.unidade} | Tem ${numBR(f.saldo)} ${f.unidade})`
    ).join('\n')}`;
    return toast(msg);
  }

  for(const b of baixas){
    const ins = await getById('insumos', Number(b.insumoId));
    if(!ins) continue;
    ins.saldo = Number((Number(ins.saldo || 0) - Number(b.consumo || 0)).toFixed(6));
    await putRecord('insumos', ins);
  }

  // entrada do produto acabado no estoque
  produto.saldo = Number((Number(produto.saldo || 0) + qtd).toFixed(6));
  await putRecord('produtos', produto);

  await addRecord('producoes', {
    data: Date.now(),
    produtoId: produto.id,
    produtoNome: produto.nome,
    qtd,
    unidade: produto.unidade || 'un',
    baixas
  });

  APP.lastProductionShareText = `Relatório de Produção - Água Lírios: Produzido ${qtd} de ${produto.nome}. Insumos consumidos com sucesso.`;
  showShareButton();
  toast('Produção registrada.');
  $('#producao-qtd').value = '';
  await refreshProducaoUI();
  await refreshEstoqueUI();
}

async function shareText(text){
  const msg = String(text || '').trim();
  if(!msg) return toast('Nada para compartilhar.');
  try{
    if(navigator.share){
      await navigator.share({text: msg});
      toast('Compartilhado.');
      return;
    }
  }catch(e){}
  try{
    await navigator.clipboard.writeText(msg);
    toast('Copiado para a área de transferência.');
  }catch(e){
    toast(msg);
  }
}

/* ---------- Estoque ---------- */
async function refreshEstoqueUI(){
  const box = document.getElementById('list-estoque');
  if(!box) return;

  const insumos = await listAll('insumos');
  const produtos = await listAll('produtos');

  insumos.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
  produtos.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));

  const renderSaldo = (saldo) => {
    const cls = Number(saldo) <= 0 ? 'saldo-alerta' : '';
    return `<span class="${cls}">${escapeHtml(numBR(saldo || 0))}</span>`;
  };

  const insumosHtml = insumos.length ? insumos.map(i => `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(i.nome || '')}</div>
        <div class="item__meta">Unid: ${escapeHtml(i.unidade || '')} • Custo Médio (Unit): R$ ${escapeHtml(moneyBR(i.custoUnit || 0))}</div>
      </div>
      <div class="item__right">Saldo: ${renderSaldo(i.saldo)}</div>
    </div>
  `).join('') : '<div class="muted">Nenhum insumo cadastrado.</div>';

  const produtosHtml = produtos.length ? produtos.map(p => `
    <div class="item">
      <div>
        <div class="item__title">${escapeHtml(p.nome || '')}</div>
        <div class="item__meta">Unid: ${escapeHtml(p.unidade || '')} • Preço Venda: R$ ${escapeHtml(moneyBR(p.precoVenda || 0))}</div>
      </div>
      <div class="item__right">Saldo: ${renderSaldo(p.saldo)}</div>
    </div>
  `).join('') : '<div class="muted">Nenhum produto cadastrado.</div>';

  box.innerHTML = `
    <div class="estoque-bloco-title">Insumos</div>
    ${insumosHtml}
    <div class="estoque-bloco-title">Produtos Acabados</div>
    ${produtosHtml}
  `;
}

/* ---------- Event delegation ---------- */
document.addEventListener('click', async (e) => {
  const t = e.target;
  if(!(t instanceof HTMLElement)) return;

  const prodEdit = t.closest('.js-prod-edit');
  if(prodEdit){
    e.preventDefault();
    const id = Number(prodEdit.getAttribute('data-id') || 0);
    if(!id) return;

    openSection('cadastros');
    setActiveTab('produtos');
    await produtosLoadToForm(id);
    window.scrollTo({top: 0, behavior: 'smooth'});
    const form = document.getElementById('form-produtos');
    if(form) form.scrollIntoView({behavior:'smooth', block:'start'});
    toast('Produto carregado para edição.');
    return;
  }

  const prodDel = t.closest('.js-prod-del');
  if(prodDel){
    e.preventDefault();
    const id = Number(prodDel.getAttribute('data-id') || 0);
    if(!id) return;
    await produtosDelete(id);
    return;
  }

  const insEdit = t.closest('.js-ins-edit');
  if(insEdit){
    e.preventDefault();
    const id = Number(insEdit.getAttribute('data-id') || 0);
    if(!id) return;

    openSection('cadastros');
    setActiveTab('insumos');
    await insumosLoadToForm(id);
    window.scrollTo({top:0, behavior:'smooth'});
    const form = document.getElementById('form-insumos');
    if(form) form.scrollIntoView({behavior:'smooth', block:'start'});
    toast('Insumo carregado para edição.');
    return;
  }

  const insDel = t.closest('.js-ins-del');
  if(insDel){
    e.preventDefault();
    const id = Number(insDel.getAttribute('data-id') || 0);
    if(!id) return;
    await insumosDelete(id);
    return;
  }

  const cliEdit = t.closest('.js-cli-edit');
  if(cliEdit){
    e.preventDefault();
    const id = Number(cliEdit.getAttribute('data-id') || 0);
    if(!id) return;
    openSection('cadastros');
    setActiveTab('clientes');
    await clientesLoadToForm(id);
    window.scrollTo({top:0, behavior:'smooth'});
    document.getElementById('form-clientes')?.scrollIntoView({behavior:'smooth', block:'start'});
    toast('Cliente carregado para edição.');
    return;
  }

  const saveLimite = t.closest('.js-save-limite');
  if(saveLimite){
    e.preventDefault();
    const id = Number(saveLimite.getAttribute('data-id') || 0);
    if(!id) return;
    const input = document.querySelector(`.js-limite-input[data-id="${id}"]`);
    const valor = Number(input?.value || 0);
    if(!Number.isFinite(valor) || valor < 0) return toast('Informe um limite válido.');
    const cliente = await getById('clientes', id);
    if(!cliente) return toast('Cliente não encontrado.');
    cliente.limiteCredito = Number(valor.toFixed(6));
    if(!Number.isFinite(Number(cliente.saldoDevedor))) cliente.saldoDevedor = 0;
    await putRecord('clientes', cliente);
    await refreshLimitesUI();
    await handleList('clientes');
    await refreshVendasUI();
    toast('Limite salvo com sucesso.');
    return;
  }

  const centroEdit = t.closest('.js-centro-edit');
  if(centroEdit){
    e.preventDefault();
    const id = Number(centroEdit.getAttribute('data-id') || 0);
    if(!id) return;
    const item = await getById('centrosCusto', id);
    if(!item) return toast('Subcusto não encontrado.');
    const novoSub = prompt('Editar nome do subcusto:', item.subcusto || '');
    if(novoSub === null) return;
    const novaObs = prompt('Editar observação:', item.observacao || '');
    if(novaObs === null) return;
    item.subcusto = String(novoSub || '').trim() || item.subcusto;
    item.observacao = String(novaObs || '').trim();
    await putRecord('centrosCusto', item);
    await handleList('centrosCusto');
    await refreshLimitesUI();
    await refreshCustosUI();
    await refreshFinanceiroUI();
    toast('Subcusto atualizado.');
    return;
  }

  const ftDel = t.closest('[data-action="remove-ft-item"]');
  if(ftDel){
    e.preventDefault();
    const ix = Number(ftDel.getAttribute('data-ix') || -1);
    if(ix >= 0){
      FT_STATE.splice(ix, 1);
      ftRender();
    }
    return;
  }
});

/* ---------- Bindings ---------- */
function bindNav(){
  document.addEventListener('click', (e)=>{
    const go = e.target?.dataset?.go;
    if(go){ openSection(go); return; }
    const listTarget = e.target?.dataset?.list;
    if(listTarget) handleList(listTarget).catch(console.error);
  });

  $$('.tab').forEach(btn => btn.addEventListener('click', ()=>{
    setActiveTab(btn.dataset.tab);
  }));

  $('#btn-resetui')?.addEventListener('click', ()=>{
    const el = $('#toast');
    if(el){ el.classList.remove('is-show'); el.textContent=''; }
  });

  $('#btn-testdb')?.addEventListener('click', async ()=>{
    const c = await listAll('clientes');
    toast(`IndexedDB OK. Clientes: ${c.length}`);
  });

  window.addEventListener('online', ()=>{
    const b = $('#badge-offline');
    if(b) b.textContent = 'Online';
  });
  window.addEventListener('offline', ()=>{
    const b = $('#badge-offline');
    if(b) b.textContent = 'Offline';
  });

  $('#producao-produto')?.addEventListener('change', ()=>updateFichaPreview().catch(console.error));
  $('#btn-producao-precheck')?.addEventListener('click', async ()=>{
    const produtoId = Number($('#producao-produto')?.value || 0);
    const qtd = parseDecimalInput($('#producao-qtd')?.value || '');
    if(!produtoId) return toast('Selecione um produto.');
    if(!Number.isFinite(qtd) || qtd <= 0) return toast('Quantidade inválida.');
    const chk = await precheckEstoque(produtoId, qtd);
    toast(chk.msg);
  });
  $('#btn-listar-producoes')?.addEventListener('click', ()=>listarProducoes().catch(console.error));
  $('#btn-share-producao')?.addEventListener('click', ()=>shareText(APP.lastProductionShareText));

  $('#btn-listar-compras')?.addEventListener('click', ()=>listarCompras().catch(console.error));
  $('#despesa-grupo')?.addEventListener('change', ()=>fillDespesaSubcustos($('#despesa-grupo')?.value || '').catch(console.error));
  $('#btn-listar-despesas')?.addEventListener('click', ()=>listarDespesas().catch(console.error));
  $('#btn-listar-insumos-estoque')?.addEventListener('click', async ()=>{
    const box = document.getElementById('list-estoque');
    if(!box) return;
    const items = await listAll('insumos');
    items.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
    const renderSaldo = (saldo) => {
      const cls = Number(saldo) <= 0 ? 'saldo-alerta' : '';
      return `<span class="${cls}">${escapeHtml(numBR(saldo || 0))}</span>`;
    };
    box.innerHTML = '<div class="estoque-bloco-title">Insumos</div>' + (items.length ? items.map(i => `
      <div class="item">
        <div>
          <div class="item__title">${escapeHtml(i.nome || '')}</div>
          <div class="item__meta">Unid: ${escapeHtml(i.unidade || '')} • Custo Médio (Unit): R$ ${escapeHtml(moneyBR(i.custoUnit || 0))}</div>
        </div>
        <div class="item__right">Saldo: ${renderSaldo(i.saldo)}</div>
      </div>
    `).join('') : '<div class="muted">Nenhum insumo.</div>');
  });
  $('#btn-listar-produtos-estoque')?.addEventListener('click', async ()=>{
    const box = document.getElementById('list-estoque');
    if(!box) return;
    const items = await listAll('produtos');
    items.sort((a,b)=>String(a.nome||'').localeCompare(String(b.nome||''), 'pt-BR'));
    const renderSaldo = (saldo) => {
      const cls = Number(saldo) <= 0 ? 'saldo-alerta' : '';
      return `<span class="${cls}">${escapeHtml(numBR(saldo || 0))}</span>`;
    };
    box.innerHTML = '<div class="estoque-bloco-title">Produtos Acabados</div>' + (items.length ? items.map(p => `
      <div class="item">
        <div>
          <div class="item__title">${escapeHtml(p.nome || '')}</div>
          <div class="item__meta">Unid: ${escapeHtml(p.unidade || '')} • Preço Venda: R$ ${escapeHtml(moneyBR(p.precoVenda || 0))}</div>
        </div>
        <div class="item__right">Saldo: ${renderSaldo(p.saldo)}</div>
      </div>
    `).join('') : '<div class="muted">Nenhum produto.</div>');
  });

  $('#btn-produtos-novo')?.addEventListener('click', ()=>{
    produtosResetForm();
    clearToast();
  });
  $('#btn-produtos-listar')?.addEventListener('click', ()=>handleList('produtos').catch(console.error));
  $('#btn-ft-add')?.addEventListener('click', ()=>ftAddRow().catch(console.error));
  $('#btn-ft-clear')?.addEventListener('click', ()=>{
    ftClear();
    toast('Ficha limpa.');
  });

  document.getElementById('ft-itens')?.addEventListener('change', (e)=>{
    if(!e.target?.matches('[data-ft-insumo]')) return;
    const sel = e.target;
    const ins = INSUMOS_CACHE.find(x=>String(x.id)===String(sel.value));
    const unitInput = sel.closest('[data-ft-row]')?.querySelector('[data-ft-unit]');
    if(unitInput && ins && !unitInput.value) unitInput.value = ins.unidade || '';
  });
}

function clearToast(){
  const el = $('#toast');
  if(el){
    el.classList.remove('is-show');
    el.textContent = '';
  }
}

/* ---------- Forms ---------- */
function bindForms(){
  $('#form-clientes')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const limiteCredito = parseDecimalInput(fd.get('limiteCredito') || '0');
    const data = {
      nome: String(fd.get('nome')||'').trim(),
      telefone: String(fd.get('telefone')||'').trim(),
      cidade: String(fd.get('cidade')||'').trim(),
      limiteCredito: Number.isFinite(limiteCredito) ? limiteCredito : 0
    };
    if(!data.nome) return toast('Informe o nome do cliente.');

    if(EDITING_CLIENTE_ID){
      const current = await getById('clientes', EDITING_CLIENTE_ID);
      if(!current) return toast('Cliente não encontrado para atualizar.');
      await putRecord('clientes', {
        ...current,
        id: Number(EDITING_CLIENTE_ID),
        nome: data.nome,
        telefone: data.telefone,
        cidade: data.cidade,
        limiteCredito: data.limiteCredito,
        saldoDevedor: Number(current.saldoDevedor || 0)
      });
      toast('Cliente atualizado.');
    }else{
      await addRecord('clientes', {
        ...data,
        saldoDevedor: 0,
        createdAt: Date.now()
      });
      toast('Cliente salvo.');
    }

    clientesResetForm();
    await handleList('clientes');
    await refreshLimitesUI();
    await refreshVendasUI();
  });

  $('#form-fornecedores')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      nome: String(fd.get('nome')||'').trim(),
      contato: String(fd.get('contato')||'').trim(),
      createdAt: Date.now()
    };
    if(!data.nome) return toast('Informe o nome do fornecedor.');
    await addRecord('fornecedores', data);
    e.target.reset();
    await handleList('fornecedores');
    toast('Fornecedor salvo.');
  });

  $('#form-funcionarios')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const data = {
      nome: String(fd.get('nome')||'').trim(),
      funcao: String(fd.get('funcao')||'').trim(),
      createdAt: Date.now()
    };
    if(!data.nome) return toast('Informe o nome do funcionário.');
    await addRecord('funcionarios', data);
    e.target.reset();
    await handleList('funcionarios');
    toast('Funcionário salvo.');
  });

  $('#form-insumos')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const fd = new FormData(e.target);
    const saldo = parseDecimalInput(fd.get('saldo') || '0');
    const custo = parseDecimalInput(fd.get('custoUnit') || '0');
    const data = {
      nome: String(fd.get('nome')||'').trim(),
      unidade: String(fd.get('unidade')||'').trim(),
      saldo: Number.isFinite(saldo) ? saldo : 0,
      custoUnit: Number.isFinite(custo) ? custo : 0
    };
    if(!data.nome || !data.unidade) return toast('Informe nome e unidade do insumo.');

    if(EDITING_INSUMO_ID){
      const current = await getById('insumos', EDITING_INSUMO_ID);
      if(!current) return toast('Insumo não encontrado para atualizar.');
      await putRecord('insumos', {...current, ...data, id: Number(EDITING_INSUMO_ID)});
      toast('Insumo atualizado.');
    }else{
      await addRecord('insumos', {...data, createdAt: Date.now()});
      toast('Insumo salvo.');
    }

    insumosResetForm();
    await handleList('insumos');
    await refreshComprasUI();
    await refreshEstoqueUI();
  });

  $('#form-produtos')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    const nome = String($('#produto-nome')?.value || '').trim();
    const unidade = String($('#produto-unidade')?.value || '').trim();
    const precoVenda = parseDecimalInput($('#produto-precoVenda')?.value || '0');
    if(!nome || !unidade) return toast('Informe nome e unidade do produto.');

    await loadInsumosCache();
    const ficha = ftSyncFromUI();

    const hiddenId = String(document.getElementById('produto-id')?.value || '').trim();
    const id = EDITING_PRODUCT_ID ? String(EDITING_PRODUCT_ID) : hiddenId;

    if(id){
      const current = await getById('produtos', Number(id));
      if(!current) return toast('Produto não encontrado para atualizar.');
      await putRecord('produtos', {
        ...current,
        id: Number(id),
        nome,
        unidade,
        precoVenda: Number.isFinite(precoVenda) ? precoVenda : 0,
        fichaTecnica: ficha
      });
      toast('Produto atualizado.');
    }else{
      await addRecord('produtos', {
        nome,
        unidade,
        precoVenda: Number.isFinite(precoVenda) ? precoVenda : 0,
        saldo: 0,
        fichaTecnica: ficha,
        createdAt: Date.now()
      });
      toast('Produto salvo.');
    }

    produtosResetForm();
    await handleList('produtos');
    await refreshProdutosSelect();
  });

  $('#form-producao')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    await registrarProducao();
  });

  
  
  // Bindings únicos para evitar duplicidade
  const bindOnce = (selector, eventName, handler, key='bound') => {
    const el = $(selector);
    if(!el || el.dataset[key]) return;
    el.addEventListener(eventName, handler);
    el.dataset[key] = '1';
  };

  bindOnce('#btn-centros-listar', 'click', ()=>handleList('centrosCusto').catch(console.error), 'clickBound');
  bindOnce('#btn-listar-compras', 'click', ()=>listarCompras().catch(console.error), 'clickBound');
  bindOnce('#btn-listar-despesas', 'click', ()=>listarDespesas().catch(console.error), 'clickBound');
  bindOnce('#financeiro-centro-filtro', 'change', ()=>refreshFinanceiroUI().catch(console.error), 'changeBound');
  
  bindOnce('#btn-listar-vendas', 'click', ()=>listarVendas().catch(console.error), 'clickBound');
  bindOnce('#btn-financeiro-atualizar', 'click', ()=>refreshFinanceiroUI().catch(console.error), 'clickBound');
  bindOnce('#venda-cliente', 'change', ()=>updateVendaClienteInfo().catch(console.error), 'changeBound');
  bindOnce('#receb-cliente', 'change', ()=>updateRecebClienteInfo().catch(console.error), 'changeBound');
  bindOnce('#despesa-grupo', 'change', ()=>fillDespesaSubcustos($('#despesa-grupo')?.value || '').catch(console.error), 'changeBound');

  ['#venda-qtd','#venda-preco','#venda-dinheiro','#venda-pix','#venda-vale'].forEach(sel => {
    bindOnce(sel, 'input', ()=>updateVendaPreview(), 'inputBound');
  });

  bindOnce('#form-vendas', 'submit', async (e)=>{
    e.preventDefault();
    if(SALE_SAVE_LOCK) return;
    const clienteId = Number($('#venda-cliente')?.value || 0);
    const produtoId = Number($('#venda-produto')?.value || 0);
    const qtd = parseDecimalInput($('#venda-qtd')?.value || '');
    const precoUnit = parseDecimalInput($('#venda-preco')?.value || '');
    const valorDinheiro = parseDecimalInput($('#venda-dinheiro')?.value || '0');
    const valorPix = parseDecimalInput($('#venda-pix')?.value || '0');
    const valorVale = parseDecimalInput($('#venda-vale')?.value || '0');

    if(!clienteId) return toast('Selecione um cliente.');
    if(!produtoId) return toast('Selecione um produto.');
    if(!Number.isFinite(qtd) || qtd <= 0) return toast('Informe uma quantidade válida.');
    if(!Number.isFinite(precoUnit) || precoUnit < 0) return toast('Informe um preço unitário válido.');
    if(!Number.isFinite(valorDinheiro) || !Number.isFinite(valorPix) || !Number.isFinite(valorVale)) return toast('Informe valores de pagamento válidos.');

    try{
      SALE_SAVE_LOCK = true;
      const r = await registrarVenda(clienteId, produtoId, qtd, precoUnit, Math.max(0, valorDinheiro), Math.max(0, valorPix), Math.max(0, valorVale));
      toast(r.msg);
      if(r.ok){
        ['#venda-cliente','#venda-produto','#venda-qtd','#venda-preco','#venda-dinheiro','#venda-pix','#venda-vale'].forEach(sel => { if($(sel)) $(sel).value=''; });
        updateVendaPreview();
        await refreshVendasUI();
        await refreshFinanceiroUI();
        await refreshEstoqueUI();
        await handleList('clientes');
      }
    } finally {
      SALE_SAVE_LOCK = false;
    }
  }, 'submitBound');

  bindOnce('#form-recebimento', 'submit', async (e)=>{
    e.preventDefault();
    if(RECEIVE_SAVE_LOCK) return;
    const clienteId = Number($('#receb-cliente')?.value || 0);
    const valor = parseDecimalInput($('#receb-valor')?.value || '');
    const formaPagamento = String($('#receb-forma')?.value || '');
    if(!clienteId) return toast('Selecione um cliente.');
    if(!Number.isFinite(valor) || valor <= 0) return toast('Informe um valor válido.');
    if(!formaPagamento) return toast('Selecione a forma de recebimento.');

    try{
      RECEIVE_SAVE_LOCK = true;
      const r = await registrarRecebimentoVale(clienteId, valor, formaPagamento);
      toast(r.msg);
      if(r.ok){
        if($('#receb-cliente')) $('#receb-cliente').value = '';
        if($('#receb-valor')) $('#receb-valor').value = '';
        if($('#receb-forma')) $('#receb-forma').value = '';
        await refreshFinanceiroUI();
        await handleList('clientes');
      }
    } finally {
      RECEIVE_SAVE_LOCK = false;
    }
  }, 'submitBound');


  
  $('#form-despesas')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    e.stopPropagation();
    if(COST_SAVE_LOCK) return false;

    const grupo = String($('#despesa-grupo')?.value || '').trim();
    const subcusto = String($('#despesa-subcusto')?.value || '').trim();
    const valor = parseDecimalInput($('#despesa-valor')?.value || '');
    const formaPagamento = String($('#despesa-pagamento')?.value || '').trim();

    if(!grupo) { toast('Selecione o centro de custo.'); return false; }
    if(!subcusto) { toast('Selecione o subcusto.'); return false; }
    if(!Number.isFinite(valor) || valor <= 0) { toast('Informe um valor válido.'); return false; }
    if(!formaPagamento) { toast('Selecione a forma de pagamento.'); return false; }

    try{
      COST_SAVE_LOCK = true;
      const r = await registrarDespesa(grupo, subcusto, valor, formaPagamento);
      toast(r.ok ? 'Salvo com sucesso.' : r.msg);
      if(r.ok){
        if($('#despesa-grupo')) $('#despesa-grupo').value = '';
        await fillDespesaSubcustos('');
        if($('#despesa-valor')) $('#despesa-valor').value = '';
        if($('#despesa-pagamento')) $('#despesa-pagamento').value = '';
        await refreshCustosUI();
        await refreshFinanceiroUI();
        openSection('view-custos');
      }
    } catch(err){
      console.error(err);
      toast('Erro ao salvar despesa.');
    } finally {
      COST_SAVE_LOCK = false;
    }
    return false;
  });

$('#form-compras')?.addEventListener('submit', async (e)=>{
    e.preventDefault();
    if(PURCHASE_SAVE_LOCK) return;
    const insumoId = Number($('#compra-insumo')?.value || 0);
    const qtd = parseDecimalInput($('#compra-qtd')?.value || '');
    const total = parseDecimalInput($('#compra-total')?.value || '');

    if(!insumoId) return toast('Selecione um insumo.');
    if(!Number.isFinite(qtd) || qtd <= 0) return toast('Informe uma quantidade válida (> 0).');
    if(!Number.isFinite(total) || total < 0) return toast('Informe um preço total válido.');

    try{
      PURCHASE_SAVE_LOCK = true;
      const r = await registrarCompra(insumoId, qtd, total);
      toast(r.msg);
      if(r.ok){
        if($('#compra-insumo')) $('#compra-insumo').value = '';
        if($('#compra-qtd')) $('#compra-qtd').value = '';
        if($('#compra-total')) $('#compra-total').value = '';
        await refreshComprasUI();
        await refreshEstoqueUI();
        await handleList('insumos');
      }
    } finally {
      PURCHASE_SAVE_LOCK = false;
    }
  });
}

/* ---------- Init ---------- */
(async function init(){
  try{
    APP.db = await openDB();
    await ensureCentrosPadrao();

    const badge = $('#badge-offline');
    if(badge) badge.textContent = navigator.onLine ? 'Online' : 'Offline';

    const status = $('#db-status');
    if(status) status.textContent = `DB: OK (${DB_NAME} v${DB_VERSION})`;

    bindNav();
    bindForms();

    openSection('home');
    setActiveTab('clientes');
    await handleList('centrosCusto');
    await refreshLimitesUI();
    await loadInsumosCache();
    ftRender();
    await refreshComprasUI();
    await refreshCustosUI();
    await refreshProducaoUI();
    await refreshVendasUI();
    await refreshFinanceiroUI();
    await refreshEstoqueUI();

    if('serviceWorker' in navigator){
      try{ await navigator.serviceWorker.register('./sw.js', {scope:'./'}); }catch(e){}
    }
  }catch(err){
    console.error(err);
    const status = $('#db-status');
    if(status) status.textContent = 'DB: ERRO';
    toast('Erro ao iniciar o banco.');
  }
})();
