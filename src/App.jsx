import React, { useEffect, useMemo, useState } from 'react';

/* === CONFIG === */
const SHEET_ID   = '1_e3KhpynZI5jCDn4GBZqXwe-IpZkiE9G1L4CQ7v8HU0';
const SHEET_NAME = 'Pedidos_Auto'; // <— EXACTO
const SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbz3evabrtId_B3Pz0QAyQ62SEcJN96cMSLKNMTRtu9IMusU1oIeDmGDG3YxQEeZkNdf/exec'; // <— tu URL /exec

/* === Utils === */
const csvUrl = (id, sheet) =>
  `https://docs.google.com/spreadsheets/d/${id}/gviz/tq?tqx=out:csv&sheet=${encodeURIComponent(sheet)}`;

const money = (n) => `S/ ${Number(n || 0).toFixed(2)}`;
const num = (v) => {
  if (v === null || v === undefined) return 0;
  let s = String(v).trim();
  if (s.match(/\d+\.\d{3,},\d+/)) s = s.replace(/\./g, '').replace(',', '.');
  else if (s.includes(',') && !s.includes('.')) s = s.replace(',', '.');
  else if (s.match(/^\d+\.\d{3,}$/)) s = s.replace(/\./g, '');
  const n = parseFloat(s);
  return isNaN(n) ? 0 : n;
};
const splitCsv = (line) => {
  const out = []; let cur = ''; let inQ = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (c === '"') {
      if (inQ && line[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) { out.push(cur); cur = ''; }
    else cur += c;
  }
  out.push(cur); return out;
};
const parseCsv = (text) => {
  const rows = text.replace(/\r\n?/g, '\n').split('\n').filter(Boolean);
  if (!rows.length) return [];
  const header = splitCsv(rows[0]).map(h => h.trim().replace(/\uFEFF/g, ''));
  return rows.slice(1).map(line => {
    const cells = splitCsv(line).map(c => c.trim());
    const o = {};
    header.forEach((h, i) => (o[h] = cells[i] ?? ''));
    return o;
  });
};
const parseDate = (s) => {
  if (!s) return null;
  const t = String(s).trim();
  const m = t.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{2,4})$/);
  if (m) {
    let d = +m[1], mo = +m[2] - 1, y = +m[3]; if (y < 100) y += 2000;
    const dt = new Date(y, mo, d); return isNaN(dt) ? null : dt;
  }
  const dt = new Date(t); return isNaN(dt) ? null : dt;
};
const norm = (s) => String(s || '').trim().toLowerCase();

/* === App === */
export default function Pedidos() {
  const [rows, setRows] = useState([]);
  const [q, setQ] = useState('');
  const [estado, setEstado] = useState('Todos');
  const [cierre, setCierre] = useState('Todos');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [loading, setLoading] = useState(true);
  const [verTotales, setVerTotales] = useState(false);
  const [modoRapido, setModoRapido] = useState(false);

  // Fetch
  useEffect(() => {
    let alive = true;
    const load = async () => {
      try {
        const res = await fetch(csvUrl(SHEET_ID, SHEET_NAME) + '&bust=' + Date.now());
        const txt = await res.text();
        if (!alive) return;
        setRows(parseCsv(txt));
      } catch (e) {
        console.error(e);
        alert('No se pudo leer la hoja. Revisa el ID y permisos.');
      } finally {
        if (alive) setLoading(false);
      }
    };
    load();
    const id = setInterval(load, 8000); // auto-refresh
    return () => { alive = false; clearInterval(id); };
  }, []);

  // Filtros
  const filtradas = useMemo(() => {
    return rows.filter(r => {
      const okQ = !q || Object.values(r).join(' ').toLowerCase().includes(q.toLowerCase());

      const d = parseDate(r['Fecha Entrega']);
      let okDate = true;
      if (from) { const f = new Date(from); f.setHours(0,0,0,0); okDate = okDate && d && d >= f; }
      if (to)   { const t = new Date(to);   t.setHours(23,59,59,999); okDate = okDate && d && d <= t; }

      const est = norm(r['Estado']);
      let estN = est;
      if (est.startsWith('1')) estN = 'entregado';
      else if (est.startsWith('0')) estN = 'por entregar';
      const okE = estado === 'Todos' || estN.includes(norm(estado));

      const ci = norm(r['Cierre']);
      const okC =
        cierre === 'Todos' ||
        (cierre === 'Cancelado' && ci === 'cancelado') ||
        (cierre === 'Activo' && (ci === '' || ci === 'activo'));

      return okQ && okDate && okE && okC;
    });
  }, [rows, q, from, to, estado, cierre]);

  // Agrupar por cliente
  const grupos = useMemo(() => {
    const map = new Map();
    for (const r of filtradas) {
      const cliente = r['Cliente']?.trim() || '(Sin nombre)';
      const item = {
        codigo: r['Código'],
        producto: r['Producto'],
        unidad: r['Unidad'],
        cantidad: num(r['Cantidad']),
        montoDesc: num(r['Monto c/Desc.']),
        debe: num(r['Debe']),
        estado: String(r['Estado'] || ''),
        fechaEntrega: r['Fecha Entrega'] || '',
      };
      const pago = Math.max(0, item.montoDesc - item.debe);

      if (!map.has(cliente)) {
        map.set(cliente, {
          cliente,
          direccion: r['Dirección'] || '',
          mapa: r['Mapa'] || '',
          celular: r['Celular'] || '',
          items: [],
          total: 0,
          debe: 0,
          pago: 0,
          todosEntregados: true,
          cantidadTotal: 0
        });
      }
      const g = map.get(cliente);
      g.items.push(item);
      g.total += item.montoDesc;
      g.debe += item.debe;
      g.pago += pago;
      g.cantidadTotal += item.cantidad;
      if (!(String(item.estado).startsWith('1'))) g.todosEntregados = false;
    }
    return Array.from(map.values()).sort((a, b) => b.debe - a.debe);
  }, [filtradas]);

  // Totales
  const totals = useMemo(() => grupos.reduce((acc, g) => {
    acc.total += g.total; acc.debe += g.debe; acc.pago += g.pago; acc.cantidad += g.cantidadTotal; return acc;
  }, { total: 0, debe: 0, pago: 0, cantidad: 0 }), [grupos]);

  // UI helpers
  const bgCard = (g) => g.todosEntregados ? 'bg-emerald-50' : (g.debe > 0 ? 'bg-rose-50' : 'bg-amber-50');

  // Acción: Marcar como entregado
  const marcarEntregado = async (g) => {
    if (!modoRapido) {
      const ok = confirm(`¿Marcar TODOS los pedidos de "${g.cliente}" como ENTREGADOS?`);
      if (!ok) return;
    }

    // Optimista: marca filas visibles como entregadas en memoria
    const optimistic = () => setRows(prev =>
      prev.map(r => {
        if (norm(r['Cliente']) === norm(g.cliente)) return { ...r, ['Estado']: '1: Entregado' };
        return r;
      })
    );
    const rollback = (snapshot) => setRows(snapshot);

    const snapshot = rows;

    try {
      if (modoRapido) optimistic();

      const res = await fetch(SCRIPT_URL, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cliente: g.cliente, nuevoEstado: '1: Entregado' })
      });

      // Puede venir sin CORS; intenta leer
      let data = null;
      try { data = await res.json(); } catch (_) {}

      if (!res.ok || !data || !data.ok) {
        if (modoRapido) rollback(snapshot);
        throw new Error((data && data.message) || 'No se pudo actualizar el estado.');
      }

      // Sin modo rápido, aplica tras confirmar
      if (!modoRapido) optimistic();
    } catch (err) {
      alert('No se pudo actualizar el estado.\n' + err.message);
    }
  };

  if (loading) return <div className="p-6 text-center text-slate-600">Cargando…</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-800">
      <div className="max-w-6xl mx-auto px-4 py-6">
        {/* Encabezado */}
        <h1 className="text-3xl font-extrabold tracking-tight mb-2">Luz del Camino — Pedidos</h1>
        <p className="text-sm text-slate-500 mb-4">Filtra por texto, estado, cierre o <b>fecha de entrega</b>.</p>

        {/* Filtros */}
        <div className="bg-white rounded-2xl shadow p-4 mb-4">
          <div className="grid md:grid-cols-6 gap-3 items-end">
            <div className="md:col-span-2">
              <label className="text-xs font-medium text-slate-600">Buscar (cliente, producto…)</label>
              <input
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2 focus:outline-none focus:ring-2 focus:ring-slate-400"
                placeholder="Ej.: Rosa, miel, tortillas…"
                value={q}
                onChange={(e) => setQ(e.target.value)}
              />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Estado</label>
              <select
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                value={estado}
                onChange={(e) => setEstado(e.target.value)}
              >
                <option>Todos</option>
                <option>Por Entregar</option>
                <option>Entregado</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Cierre</label>
              <select
                className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                value={cierre}
                onChange={(e) => setCierre(e.target.value)}
              >
                <option>Todos</option>
                <option>Activo</option>
                <option>Cancelado</option>
              </select>
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Desde</label>
              <input type="date" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                     value={from} onChange={(e) => setFrom(e.target.value)} />
            </div>
            <div>
              <label className="text-xs font-medium text-slate-600">Hasta</label>
              <input type="date" className="mt-1 w-full rounded-xl border border-slate-300 px-3 py-2"
                     value={to} onChange={(e) => setTo(e.target.value)} />
            </div>

            <div className="flex items-center gap-2">
              <input id="rapido" type="checkbox" checked={modoRapido} onChange={e => setModoRapido(e.target.checked)} />
              <label htmlFor="rapido" className="text-xs text-slate-600">Modo rápido (sin confirmar)</label>
            </div>
          </div>
        </div>

        {/* Totales con clave */}
        <div className="text-right mb-3">
          {!verTotales ? (
            <button
              onClick={() => { const key = prompt('Ingrese la clave para ver totales:'); if (key === '2727') setVerTotales(true); else alert('❌ Clave incorrecta'); }}
              className="text-sm text-blue-600 underline"
            >
              🔒 Mostrar totales
            </button>
          ) : (
            <button onClick={() => setVerTotales(false)} className="text-sm text-red-600 underline">
              🔐 Ocultar totales
            </button>
          )}
        </div>

        {verTotales && (
          <div className="grid md:grid-cols-4 gap-3 mb-4">
            <Stat label="Total pedidos (clientes)" value={grupos.length} />
            <Stat label="Total Cantidad" value={totals.cantidad.toLocaleString('es-PE')} />
            <Stat label="Total Monto Descontado" value={money(totals.total)} />
            <Stat label="Total Debe / Pagado" value={`${money(totals.debe)} / ${money(totals.pago)}`} emph />
          </div>
        )}

        {/* Tarjetas por cliente */}
        {grupos.map(g => (
          <div key={g.cliente} className={`${bgCard(g)} rounded-2xl shadow p-5 mb-4 border`}>
            <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
              <div>
                <h2 className="text-xl font-bold">{g.cliente}</h2>
                <div className="text-sm text-slate-600 mt-1">🏡 {g.direccion || 'Zona no especificada'}</div>
                <div className="text-sm text-slate-600 mt-1">
                  📍 {g.mapa
                      ? (g.mapa.startsWith('http')
                          ? <a href={g.mapa} target="_blank" rel="noreferrer" className="text-blue-600 underline">Ver ubicación</a>
                          : g.mapa)
                      : 'Ubicación no registrada'}
                </div>
                {g.celular && (
                  <div className="text-sm text-slate-600 mt-1">
                    📞 <a href={`https://wa.me/51${g.celular.replace(/\D/g,'')}`} target="_blank" rel="noreferrer"
                         className="text-emerald-600 underline">{g.celular}</a>
                  </div>
                )}
              </div>

              <div className="text-sm text-right">
                <span className="inline-block rounded-lg bg-rose-100 text-rose-700 px-3 py-1 mr-2">
                  Debe: <b>{money(g.debe)}</b>
                </span>
                <span className="inline-block rounded-lg bg-emerald-100 text-emerald-700 px-3 py-1 mr-2">
                  Pagó: <b>{money(g.pago)}</b>
                </span>
                {!g.todosEntregados && (
                  <button
                    onClick={() => marcarEntregado(g)}
                    className="bg-emerald-600 hover:bg-emerald-700 text-white px-3 py-2 rounded-lg text-sm"
                  >
                    ✅ Marcar como Entregado
                  </button>
                )}
              </div>
            </div>

            <div className="mt-4 overflow-x-auto">
              <table className="min-w-full text-sm">
                <thead>
                  <tr className="text-slate-500 border-b">
                    <th className="text-left py-2 pr-3">Producto</th>
                    <th className="text-right py-2 pr-3">Cant.</th>
                    <th className="text-right py-2 pr-3">Unidad</th>
                    <th className="text-right py-2 pr-3">Monto c/Desc.</th>
                    <th className="text-right py-2 pr-3">Debe</th>
                    <th className="text-right py-2 pr-3">Pagó</th>
                  </tr>
                </thead>
                <tbody>
                  {g.items.map((it, i) => {
                    const pago = Math.max(0, it.montoDesc - it.debe);
                    return (
                      <tr key={i} className="border-b last:border-0">
                        <td className="py-2 pr-3">{it.producto}</td>
                        <td className="py-2 pr-3 text-right">{it.cantidad}</td>
                        <td className="py-2 pr-3 text-right">{it.unidad}</td>
                        <td className="py-2 pr-3 text-right">{money(it.montoDesc)}</td>
                        <td className="py-2 pr-3 text-right text-rose-600 font-semibold">{money(it.debe)}</td>
                        <td className="py-2 pr-3 text-right text-emerald-700 font-semibold">{money(pago)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>

            <div className="mt-3 text-right text-sm text-slate-700 font-medium">
              <span className="mr-4">Cantidad: {g.cantidadTotal.toLocaleString('es-PE')}</span>
              <span className="mr-4">Total: {money(g.total)}</span>
              <span className="mr-4">Pagado: {money(g.pago)}</span>
              <span>Debe: <b className="text-rose-700">{money(g.debe)}</b></span>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function Stat({ label, value, emph }) {
  return (
    <div className={`bg-white rounded-2xl shadow p-4 ${emph ? 'ring-2 ring-emerald-400' : ''}`}>
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="text-xl font-semibold mt-1">{value}</div>
    </div>
  );
}
