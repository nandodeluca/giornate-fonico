import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as C from '../src/core.js';

const S = [
  { id: 'a', name: 'ALFA', colorId: '5', keywords: ['alfa'], tipo: 'giornata', tariffa: 250, oreIncluse: 10, straordinario: 25, doppiaDa: 5 },
  { id: 'b', name: 'BETA', colorId: '3', keywords: ['beta'], tipo: 'giornata', tariffa: 250, oreIncluse: 9, straordinario: 25, doppiaDa: 5 },
  { id: 'c', name: 'GAMMA', colorId: '1', keywords: ['gamma'], tipo: 'fissa', tariffa: 250 },
  { id: 'd', name: 'DELTA', colorId: '1', keywords: ['delta', 'd&e'], tipo: 'fissa', tariffa: 250 },
  { id: 't', name: 'TAU', colorId: '6', keywords: ['tau'], tipo: 'giornata', tariffa: 300, oreIncluse: 10, straordinario: 30, doppiaDa: 5 },
];
const ev = (summary, description = '', colorId = '5', start = '2026-01-10', end = null, id = 'e1') =>
  ({ id, summary, description, colorId, start: { date: start }, end: { date: end || C.addDays(start, 1) } });
const day = (e, ov = null, today = '2026-12-31') => C.computeDay({ ev: e, date: e.start.date, multi: false, services: S, override: ov, today });

test('formati degli orari', () => {
  const cases = [
    ['7:30 - 19:30 +2 ore extra', 12 * 60],
    ['h. 10 - h. 21:50', 11 * 60 + 50],
    ['1500 - 01:00', 10 * 60],
    ['9 - 18:00 / Hotel', 9 * 60],
    ['Banca 8-13', 5 * 60],
    ['h.9- 21:00 +2 ore extra', 12 * 60],
    ['h.7:30 - 20:30', 13 * 60],
    ['12:00 in magazzino - 2:00 magazzino', 14 * 60],
    ['Via Roma 8 - Settimo / 7:00 - 17:00', 10 * 60],
    ['8:00-11:00 + 16:00-17:30', 4 * 60 + 30],
    ['14:00 - 02:30 (+4 ore extra, no pausa cena)', 12 * 60 + 30],
  ];
  for (const [t, min] of cases) assert.equal(C.parseTimes(t)?.minutes, min, t);
});

test('solo inizio e nessun orario', () => {
  assert.equal(C.hhmm(C.parseTimes('h.9 Banca')?.partialStart), '9:00');
  assert.equal(C.hhmm(C.parseTimes('sala 13:30-')?.partialStart), '13:30');
  assert.equal(C.hhmm(C.parseTimes('9 Consegna + schede')?.partialStart), '9:00');
  assert.equal(C.parseTimes('Banca d\'Italia'), null);
  assert.equal(C.parseTimes('id evento 52262'), null);
});

test('note: straordinari e rimborsi', () => {
  assert.equal(C.parseNotedOvertime('7:30 - 18:25 (+2 ore extra)'), 2);
  assert.equal(C.parseNotedOvertime('8:00 - 19:00 (1 ora extra)'), 1);
  assert.equal(C.parseNotedOvertime('+1 ora extra NON MESSA'), null);
  assert.deepEqual(C.parseExpenses('8-18 +20 pranzo'), [{ amount: 20, desc: 'pranzo' }]);
  assert.deepEqual(C.parseExpenses('+ 9,90 pranzo'), [{ amount: 9.9, desc: 'pranzo' }]);
  assert.deepEqual(C.parseExpenses('15:30 - 23:00 / + 18 euro cena'), [{ amount: 18, desc: 'cena' }]);
  assert.deepEqual(C.parseExpenses('125+250 / +25 / +25').map(r => r.amount), [25, 25]);
  assert.deepEqual(C.parseExpenses('h.9- 21:00 +2 ore extra'), []);
});

test('abbinamento service: nome, colore, colore condiviso', () => {
  assert.equal(C.matchService(ev('Alfa Milano'), S).service.id, 'a');
  assert.equal(C.matchService(ev('Qualcosa', '', '6'), S).service.id, 't');
  const amb = C.matchService(ev('Lavoro', '', '1'), S);
  assert.equal(amb.service, null);
  assert.equal(amb.candidates.length, 2);
  assert.equal(C.matchService(ev('D&E Roma', '', '1'), S).service.id, 'd');
  assert.equal(C.matchService(ev('Alfabeto', '', null), S), null);
});

test('straordinario: ogni ora iniziata conta', () => {
  assert.equal(day(ev('Alfa', '8:00 - 18:00')).compenso, 250);
  assert.equal(day(ev('Alfa', '8:00 - 18:01')).compenso, 275);
  assert.equal(day(ev('Alfa', '8:00 - 20:30')).compenso, 325);
  assert.equal(day(ev('Beta', '15:00 - 01:00', '3')).compenso, 275); // 9 ore incluse
});

test('doppia dalla 5a ora di straordinario, comprende tutto', () => {
  assert.equal(day(ev('Alfa', '8:00 - 22:00')).compenso, 350); // 14 h esatte
  const d = day(ev('Alfa', '8:00 - 22:01'));
  assert.equal(d.tipo, 'doppia');
  assert.equal(d.compenso, 500);
  assert.equal(day(ev('Alfa', '9:00 - 02:00')).compenso, 500);
  assert.equal(day(ev('Tau', '8:30 - 23:00', '6')).compenso, 600);
  assert.equal(day(ev('Beta', '12:00 - 2:00', '3')).compenso, 500); // 14 h con 9 incluse
});

test('giornata fissa: mai straordinari', () => {
  assert.equal(day(ev('Gamma', '6:00 - 23:00', '1')).compenso, 250);
});

test('nota diversa dal calcolo: segnalata, e la scelta a mano vince', () => {
  const d = day(ev('Alfa', '14:00 - 02:30 (+4 ore extra)'));
  assert.equal(d.otHours, 3);
  assert.ok(d.issues.some(i => i.code === 'straord'));
  assert.equal(day(ev('Alfa', '14:00 - 02:30 (+4 ore extra)'), { otHours: 4 }).compenso, 350);
});

test('reperibilità: cifra a mano', () => {
  const d = day(ev('Alfa MP DISP', '8 - 18'));
  assert.equal(d.tipo, 'reperibilita');
  assert.ok(d.issues.some(i => i.code === 'disp'));
  const d2 = day(ev('Alfa MP DISP', '8 - 18'), { compenso: 200 });
  assert.equal(d2.compenso, 200);
  assert.equal(d2.status, 'ok');
});

test('evento su più giorni e futuro', () => {
  const e = ev('Alfa Fiera', '', '5', '2026-03-01', '2026-03-04');
  const { days } = C.buildDays([e], { ...C.emptyData(), services: S }, { from: '2026-03-01', to: '2026-04-01' }, '2026-02-01');
  assert.equal(days.length, 3);
  assert.ok(days.every(d => d.status === 'prevista'));
});

test('titolo e descrizione: vince la descrizione e segnala la differenza', () => {
  const d = day(ev('Alfa MP 8-17', '8-18 +20 pranzo'));
  assert.equal(d.minutes, 600);
  assert.equal(d.rimborsiTot, 20);
  assert.ok(d.issues.some(i => i.code === 'titolo'));
  assert.equal(day(ev('Alfa 8:30-15:00', '+ 9,90 pranzo')).minutes, 390);
});

test('riepilogo mensile e IVA', () => {
  const evs = [ev('Alfa Uno', '8 - 18', '5', '2026-05-02', null, 'x1'), ev('Alfa Due', '8 - 20:30 / + 18 euro cena', '5', '2026-05-03', null, 'x2')];
  const data = { ...C.emptyData(), services: S };
  const { days } = C.buildDays(evs, data, { from: '2026-05-01', to: '2026-06-01' }, '2026-12-31');
  const [sum] = C.summarize(days, S, '2026-05', data);
  assert.equal(sum.compensi, 575);
  assert.equal(sum.rimborsi, 18);
  assert.equal(sum.ivaImp, 126.5);
  assert.equal(sum.totale, 719.5);
  assert.match(C.invoiceText(sum, '2026-05'), /Compensi: 575 € \+ IVA 22%/);
});

test('unione dati tra dispositivi: vince il più recente', () => {
  const a = { ...C.emptyData(), days: { k1: { otHours: 1, updatedAt: 10 }, k2: { nota: 'pc', updatedAt: 5 } } };
  const b = { ...C.emptyData(), days: { k1: { otHours: 2, updatedAt: 20 }, k3: { nota: 'tel', updatedAt: 1 } } };
  const m = C.mergeData(a, b);
  assert.equal(m.days.k1.otHours, 2);
  assert.equal(m.days.k2.nota, 'pc');
  assert.equal(m.days.k3.nota, 'tel');
});

test('versioni', () => {
  assert.ok(C.isNewerVersion('v1.0.10', '1.0.9'));
  assert.ok(!C.isNewerVersion('1.0.0', '1.0.0'));
});

test('scadenze di pagamento a fine mese', () => {
  assert.equal(C.paymentMonth('2026-09', 30), '2026-10');
  assert.equal(C.paymentMonth('2026-09', 60), '2026-11');
  assert.equal(C.paymentMonth('2026-11', 90), '2027-02');
  assert.equal(C.lastDayOfMonth('2027-02'), '2027-02-28');
});

test('clienti della cooperativa -> service', () => {
  const sv = [
    { id: 'on', name: 'ONAIR', keywords: ['onair', 'on air'] },
    { id: 'ad', name: 'AD MANAGEMENT', keywords: ['ad management', 'a&l'] },
    { id: 'te', name: 'TECNO CONFERENCE', keywords: ['tecno'], fatturazione: { ragioneSociale: 'Tecnoconference S.r.l.' } },
  ];
  assert.equal(C.serviceForClient('ON AIR MULTIMEDIA SRL', sv).id, 'on');
  assert.equal(C.serviceForClient('AD MANAGEMENT SRL', sv).id, 'ad');
  assert.equal(C.serviceForClient('TECNOCONFERENCE S.R.L.', sv).id, 'te');
  assert.equal(C.serviceForClient('ALTRO CLIENTE', sv), null);
});

test('lettura righe fatture e eventi della cooperativa', () => {
  const f = C.parseCoopInvoices([
    { cls: 'bg-success-subtle', cells: ['F', 'ALFA SRL', 'TEATRO X [09/05-09/05 ] ', '13/05/2026', '1065', '250,00', '157,91'] },
    { cls: '', cells: ['F', 'BETA SRL', 'HOTEL Y [24/12-24/12 ] HOTEL Y [30/12-30/12 ]', '08/01/2027', '12', '1.312,00', ''] },
  ]);
  assert.equal(f.length, 2);
  assert.deepEqual([f[0].pagata, f[0].imponibile, f[0].netto, f[0].meseLavoro], [true, 250, 157.91, '2026-05']);
  assert.deepEqual([f[1].pagata, f[1].imponibile, f[1].netto, f[1].meseLavoro], [false, 1312, null, '2026-12']);
  const e = C.parseCoopEvents([{ cells: ['', '01/12/26', 'HOTEL QUARK', 'HOTEL...', '', '150'] }]);
  assert.deepEqual(e, [{ data: '2026-12-01', luogo: 'HOTEL QUARK' }]);
});

test('prospetto incassi: stimato e reale', () => {
  const svc = { id: 'on', name: 'ONAIR', keywords: ['onair', 'on air'], pagamentoGiorni: 60 };
  const sums = { '2026-10': [{ service: svc, compensi: 2600, rimborsi: 20, giornate: 10, previste: 0 }], '2026-11': [{ service: svc, compensi: 1000, rimborsi: 0, giornate: 4, previste: 1 }] };
  const data = { settings: { trattenutaCoop: 30 }, coop: { fatture: [{ numero: '2833', cliente: 'ON AIR MULTIMEDIA SRL', tipo: 'F', meseLavoro: '2026-10', netto: 1641.12, pagata: false }] } };
  const fc = C.buildForecast(sums, [svc], data);
  assert.deepEqual(fc.map(m => m.mese), ['2026-12', '2027-01']);
  assert.equal(fc[0].netto, 1641.12);
  assert.equal(fc[0].righe[0].nettoReale, true);
  assert.equal(fc[0].rimborsi, 0);
  assert.equal(fc[1].netto, 700);
});

test('giornate aperte dalla cooperativa vs calendario', () => {
  const work = [{ date: '2026-12-01' }, { date: '2026-12-02' }, { date: '2026-12-05', escluso: true }];
  const r = C.enpalsCompare(work, [{ data: '2026-12-01', luogo: 'Q' }, { data: '2026-12-09', luogo: 'Z' }], '2026-11-01');
  assert.deepEqual(r.mancanti.map(d => d.date), ['2026-12-02']);
  assert.deepEqual(r.inPiu.map(e => e.data), ['2026-12-09']);
});

test('giornate in opzione (???): visibili ma non conteggiate', () => {
  const e1 = ev('Alfa???', '8 - 18', '5', '2026-06-02', null, 'o1');
  const e2 = ev('Alfa Fiera', '8 - 18', '5', '2026-06-03', null, 'o2');
  const data = { ...C.emptyData(), services: S };
  const { days } = C.buildDays([e1, e2], data, { from: '2026-06-01', to: '2026-07-01' }, '2026-12-31');
  assert.equal(days.length, 2);
  const o = days.find(d => d.eventId === 'o1');
  assert.equal(o.status, 'opzione');
  assert.equal(o.place, '');
  const [sum] = C.summarize(days, S, '2026-06', data);
  assert.equal(sum.giornate, 1);
  assert.equal(sum.compensi, 250);
  const r = C.enpalsCompare(days, [], '2026-06-01');
  assert.deepEqual(r.mancanti.map(d => d.date), ['2026-06-03']);
});

test('concerti: cifra netta dall\'evento, conteggio a parte', () => {
  const SC = [...S, { id: 'concerti', name: 'CONCERTI', colorId: '9', keywords: [], tipo: 'concerti' }];
  assert.equal(C.parseConcertFee('Sigla! @ Bonaventura 150 €'), 150);
  assert.equal(C.parseConcertFee('cachet: 200'), 200);
  assert.equal(C.parseConcertFee('€ 180,50 netti'), 180.5);
  assert.equal(C.parseConcertFee('Sigla! @ Bonaventura (MI)'), null);
  const evs = [
    ev('Sigla! @ Bonaventura (MI)', '200 €', '9', '2026-12-19', null, 'c1'),
    ev('Band @ Locale', '', '9', '2026-12-05', null, 'c2'),
    ev('Alfa Fiera', '8 - 18', '5', '2026-12-03', null, 'a1'),
  ];
  const data = { ...C.emptyData(), services: SC };
  const { days } = C.buildDays(evs, data, { from: '2026-12-01', to: '2027-01-01' }, '2026-12-31');
  const c1 = days.find(d => d.eventId === 'c1');
  assert.equal(c1.concerto, true);
  assert.equal(c1.compenso, 200);
  assert.equal(c1.place, 'Sigla! @ Bonaventura (MI)');
  assert.ok(days.find(d => d.eventId === 'c2').issues.some(i => i.code === 'cachet'));
  const sums = C.summarize(days, SC, '2026-12', data);
  assert.deepEqual(sums.map(x => x.service.id), ['a']);
  const cs = C.concertSummary(days);
  assert.equal(cs[0].totale, 200);
  assert.equal(cs[0].senzaCifra, 1);
  assert.deepEqual(C.enpalsCompare(days, [], '2026-12-01').mancanti.map(d => d.date), ['2026-12-03']);
});

test('concerti: basta il numero nella descrizione', () => {
  assert.equal(C.parseConcertFee('80', true), 80);
  assert.equal(C.parseConcertFee('soundcheck 18:00 - 80', true), 80);
  assert.equal(C.parseConcertFee('h 21 / 120 netti', true), 120);
  assert.equal(C.parseConcertFee('80', false), null);
  assert.equal(C.parseConcertFee('Sigla! @ Bonaventura (MI)', true), null);
});
