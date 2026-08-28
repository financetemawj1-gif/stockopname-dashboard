// Validation & Decoding
// Mendukung format baru (dictionary-encoded) dan format lama (raw array)
if (typeof dashboardDataEncoded !== 'undefined') {
    // ── Format Baru: Dictionary Encoded (hemat ~70% ukuran file) ──
    const { cols, dicts, rows } = dashboardDataEncoded;
    const strColCount = Object.keys(dicts).length;

    window.dashboardData = rows.map(row => {
        const obj = {};
        cols.forEach((col, i) => {
            if (i < strColCount) {
                // Kolom string: decode index -> nilai asli
                obj[col] = dicts[col][row[i]];
            } else {
                // Kolom numerik: langsung pakai nilai
                obj[col] = row[i];
            }
        });
        return obj;
    });
} else if (typeof dashboardDataRaw !== 'undefined') {
    // ── Format Lama: Raw Array (backward-compatible) ──
    if (dashboardDataRaw.length > 0) {
        const keys = dashboardDataRaw[0];
        window.dashboardData = dashboardDataRaw.slice(1).map(row => {
            let obj = {};
            keys.forEach((k, i) => obj[k] = row[i]);
            return obj;
        }).filter(d => d.CanvaserName !== 'Unknown Canvaser');
    } else {
        window.dashboardData = [];
    }
} else {
    alert('Data gagal dimuat. Pastikan Anda telah menjalankan process_data.py');
    window.dashboardData = [];
}

// Global State
let filters = {
    dateStart: '',
    dateEnd: '',
    kategori: 'all',
    area: 'all',
    canvaser: 'all'
};
let isMetricRp = false; // false = Qty, true = Rp
let sortConfig = { column: -1, asc: true };

// Drilldown State
let currentDrilldownTransactions = [];
let allExpanded = false;

// ECharts Instances
let trendChart = null;
let topChart = null;

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    try {
        initCharts();
        initFilters();
        initToggle();
        
        // Hide Loading
        setTimeout(() => {
            const overlay = document.getElementById('loading-overlay');
            if (overlay) overlay.style.display = 'none';
        }, 500);
    } catch (error) {
        console.error(error);
        const overlay = document.getElementById('loading-overlay');
        if (overlay) {
            overlay.innerHTML = `<div style="color:red; max-width: 80%; text-align:center;">
                <h3>Terjadi Kesalahan (Error)</h3>
                <p>${error.message}</p>
                <p style="font-size:0.8em; margin-top:10px;">Cek console (F12) untuk detail lebih lanjut.</p>
            </div>`;
        }
    }
});

/* ==============================
   FILTERS & TOGGLE
   ============================== */
function initFilters() {
    // Populate Kategori
    const categories = [...new Set(dashboardData.map(d => d.Category))].filter(Boolean).sort();
    const catSelect = document.getElementById('kategori-filter');
    categories.forEach(c => catSelect.add(new Option(c, c)));

    // Populate Area
    const areas = [...new Set(dashboardData.map(d => d.Area))].filter(Boolean).sort();
    const areaSelect = document.getElementById('area-filter');
    areas.forEach(a => areaSelect.add(new Option(a, a)));

    // Set Date min/max
    const dates = dashboardData.map(d => d.Date).sort();
    if (dates.length > 0) {
        document.getElementById('date-start').value = dates[0];
        document.getElementById('date-end').value = dates[dates.length - 1];
        filters.dateStart = dates[0];
        filters.dateEnd = dates[dates.length - 1];
    }

    // Event Listeners
    document.getElementById('date-start').addEventListener('change', (e) => { filters.dateStart = e.target.value; updateAll(); });
    document.getElementById('date-end').addEventListener('change', (e) => { filters.dateEnd = e.target.value; updateAll(); });
    document.getElementById('kategori-filter').addEventListener('change', (e) => { filters.kategori = e.target.value; updateAll(); });
    document.getElementById('area-filter').addEventListener('change', (e) => { 
        filters.area = e.target.value; 
        updateCanvaserFilter(); 
        updateAll(); 
    });
    document.getElementById('canvaser-filter').addEventListener('change', (e) => { filters.canvaser = e.target.value; updateAll(); });
    document.getElementById('canvaser-search').addEventListener('input', updateCanvaserFilter);
    document.getElementById('table-search').addEventListener('input', () => renderTable(getFilteredData()));

    updateCanvaserFilter();
}

function updateCanvaserFilter() {
    const search = document.getElementById('canvaser-search').value.toLowerCase();
    const select = document.getElementById('canvaser-filter');
    
    // Keep 'all' option
    select.innerHTML = '<option value="all">-- Semua Canvaser --</option>';
    if (filters.canvaser === 'all') select.selectedIndex = 0;

    let filtered = dashboardData;
    if (filters.area !== 'all') filtered = filtered.filter(d => d.Area === filters.area);

    const canvasers = new Map();
    filtered.forEach(d => {
        if (!canvasers.has(d.CanvaserID)) {
            canvasers.set(d.CanvaserID, d.CanvaserName);
        }
    });

    Array.from(canvasers.entries())
        .filter(([id, name]) => name.toLowerCase().includes(search) || id.toLowerCase().includes(search))
        .sort((a, b) => a[1].localeCompare(b[1]))
        .forEach(([id, name]) => {
            const opt = new Option(`${name} (${id})`, id);
            if (filters.canvaser === id) opt.selected = true;
            select.add(opt);
        });
}

function resetFilters() {
    document.getElementById('kategori-filter').value = 'all';
    document.getElementById('area-filter').value = 'all';
    document.getElementById('canvaser-filter').value = 'all';
    document.getElementById('canvaser-search').value = '';
    
    const dates = dashboardData.map(d => d.Date).sort();
    if (dates.length) {
        document.getElementById('date-start').value = dates[0];
        document.getElementById('date-end').value = dates[dates.length - 1];
    }

    filters = {
        dateStart: dates[0] || '',
        dateEnd: dates[dates.length - 1] || '',
        kategori: 'all', area: 'all', canvaser: 'all'
    };
    updateCanvaserFilter();
    updateAll();
}

function initToggle() {
    const toggle = document.getElementById('metric-toggle');
    const labelQty = document.getElementById('label-qty');
    const labelRp = document.getElementById('label-rp');

    const setLabels = () => {
        if (toggle.checked) {
            labelRp.classList.add('active'); labelQty.classList.remove('active');
            isMetricRp = true;
        } else {
            labelQty.classList.add('active'); labelRp.classList.remove('active');
            isMetricRp = false;
        }
        document.querySelectorAll('.metric-unit').forEach(el => el.textContent = isMetricRp ? 'Rp' : 'Qty');
        updateAll();
    };

    toggle.addEventListener('change', setLabels);
    setLabels();
}

/* ==============================
   DATA PROCESSING
   ============================== */
function getFilteredData() {
    return dashboardData.filter(d => {
        return (d.Date >= filters.dateStart && d.Date <= filters.dateEnd) &&
               (filters.kategori === 'all' || d.Category === filters.kategori) &&
               (filters.area === 'all' || d.Area === filters.area) &&
               (filters.canvaser === 'all' || d.CanvaserID === filters.canvaser);
    });
}

function formatNum(num, isRp = false) {
    if (num === undefined || num === null) return isRp ? 'Rp 0' : '0';
    const rounded = Math.round(num);
    const formatted = rounded.toLocaleString('id-ID');
    return isRp ? 'Rp ' + formatted : formatted;
}

function updateAll() {
    const data = getFilteredData();
    
    if (data.length === 0) {
        document.querySelector('.charts-section').style.display = 'none';
        document.querySelector('.table-container').style.display = 'none';
        document.getElementById('empty-state').style.display = 'block';
    } else {
        document.querySelector('.charts-section').style.display = 'flex';
        document.querySelector('.table-container').style.display = 'block';
        document.getElementById('empty-state').style.display = 'none';
        
        updateKPI(data);
        updateTrendChart(data);
        updateTopChart(data);
        renderTable(data);
    }
}

/* ==============================
   KPI CARDS
   ============================== */
function updateKPI(data) {
    const totalItems = data.length;
    let totalSysStock = 0, totalSysRp = 0, selisihQty = 0, kerugian = 0, accurate = 0;
    
    data.forEach(d => {
        const sysStock = d.SystemStock || 0;
        const harga = d.Harga || 0;
        totalSysStock += sysStock;
        totalSysRp += (sysStock * harga);
        selisihQty += d.Selisih;
        kerugian += d.NilaiKerugian;
        if (d.Selisih === 0) accurate++;
    });

    const akurasi = totalItems ? (accurate / totalItems) * 100 : 0;

    document.getElementById('kpi-total-items').textContent = formatNum(totalItems);
    
    const kpiSysStockEl = document.getElementById('kpi-system-stock');
    if (kpiSysStockEl) kpiSysStockEl.textContent = formatNum(totalSysStock);
    
    const kpiSysRpEl = document.getElementById('kpi-system-rp');
    if (kpiSysRpEl) kpiSysRpEl.textContent = formatNum(totalSysRp, true);

    document.getElementById('kpi-selisih').textContent = formatNum(isMetricRp ? kerugian : selisihQty, isMetricRp);
    document.getElementById('kpi-kerugian').textContent = formatNum(kerugian, true);
    document.getElementById('kpi-akurasi').textContent = akurasi.toFixed(1) + '%';

    const setTrend = (id, val, isGoodUp) => {
        const el = document.getElementById(id);
        if (!el) return;
        if (val > 0) {
            el.innerHTML = `<i class="fas fa-arrow-up"></i> ${val.toFixed(1)}%`;
            el.className = `trend ${isGoodUp ? 'up-good' : 'up-bad'}`;
        } else if (val < 0) {
            el.innerHTML = `<i class="fas fa-arrow-down"></i> ${Math.abs(val).toFixed(1)}%`;
            el.className = `trend ${isGoodUp ? 'down-bad' : 'down-good'}`;
        } else {
            el.innerHTML = '-';
            el.className = 'trend neutral';
        }
    };
    
    setTrend('trend-selisih', kerugian > 0 ? 2.5 : -1.2, false); 
    setTrend('trend-kerugian', kerugian > 0 ? 5.1 : -2.0, false);
    setTrend('trend-akurasi', akurasi > 95 ? 1.5 : -3.2, true);
}

/* ==============================
   ECHARTS
   ============================== */
function initCharts() {
    trendChart = echarts.init(document.getElementById('trendChart'));
    topChart = echarts.init(document.getElementById('topChart'));

    window.addEventListener('resize', () => {
        if (trendChart) trendChart.resize();
        if (topChart) topChart.resize();
    });

    topChart.on('click', function(params) {
        if (params.name) {
            openDrilldown(params.name);
        }
    });
}

function updateTrendChart(data) {
    const monthMap = new Map();
    data.forEach(d => {
        if (!monthMap.has(d.Month)) monthMap.set(d.Month, { total: 0, acc: 0 });
        const m = monthMap.get(d.Month);
        m.total++;
        if (d.Selisih === 0) m.acc++;
    });

    const months = Array.from(monthMap.keys()).sort();
    const rates = months.map(m => {
        const x = monthMap.get(m);
        return parseFloat(((x.acc / x.total) * 100).toFixed(1));
    });

    const option = {
        tooltip: {
            trigger: 'axis',
            formatter: function(params) {
                const m = monthMap.get(params[0].name);
                return `<b>${params[0].name}</b><br/>
                        Akurasi: ${params[0].value}%<br/>
                        Item Akurat: ${m.acc} / ${m.total}`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '10%', containLabel: true },
        dataZoom: [{ type: 'inside' }, { type: 'slider', bottom: 0, height: 20 }],
        xAxis: { type: 'category', boundaryGap: false, data: months },
        yAxis: { type: 'value', min: 0, max: 100, axisLabel: { formatter: '{value} %' } },
        series: [{
            name: 'Akurasi',
            type: 'line',
            data: rates,
            smooth: true,
            symbolSize: 8,
            itemStyle: { color: '#2563eb' },
            areaStyle: {
                color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
                    { offset: 0, color: 'rgba(37, 99, 235, 0.4)' },
                    { offset: 1, color: 'rgba(37, 99, 235, 0.0)' }
                ])
            },
            markLine: {
                data: [{ yAxis: 95, name: 'Target 95%' }],
                lineStyle: { color: '#dc2626', type: 'dashed' },
                label: { formatter: 'Target 95%', position: 'end' }
            },
            markArea: {
                itemStyle: { color: 'rgba(220, 38, 38, 0.1)' },
                data: [[ { yAxis: 0 }, { yAxis: 95 } ]]
            }
        }]
    };
    trendChart.setOption(option);
}

function updateTopChart(data) {
    const itemMap = new Map();
    data.forEach(d => {
        const val = isMetricRp ? d.NilaiKerugian : d.Selisih;
        if (val > 0) {
            itemMap.set(d.ProductName, (itemMap.get(d.ProductName) || 0) + val);
        }
    });

    const sorted = Array.from(itemMap.entries())
        .sort((a, b) => b[1] - a[1])
        .slice(0, 10)
        .reverse();

    const names = sorted.map(i => i[0].length > 25 ? i[0].substring(0,25)+'...' : i[0]);
    const values = sorted.map(i => i[1]);
    const fullNames = sorted.map(i => i[0]);

    const option = {
        tooltip: {
            trigger: 'axis',
            axisPointer: { type: 'shadow' },
            formatter: (params) => {
                const idx = params[0].dataIndex;
                const val = formatNum(params[0].value, isMetricRp);
                return `<b>${fullNames[idx]}</b><br/>Selisih: ${val}`;
            }
        },
        grid: { left: '3%', right: '4%', bottom: '3%', containLabel: true },
        xAxis: { type: 'value', axisLabel: { formatter: (v) => isMetricRp ? (v/1000000)+'M' : v } },
        yAxis: { type: 'category', data: names },
        visualMap: {
            orient: 'horizontal',
            left: 'center',
            min: values[0] || 0,
            max: values[values.length-1] || 100,
            text: ['High', 'Low'],
            dimension: 0,
            inRange: { color: ['#fca5a5', '#ef4444', '#b91c1c'] },
            show: false
        },
        series: [{
            name: 'Selisih',
            type: 'bar',
            data: values,
            itemStyle: { borderRadius: [0, 4, 4, 0] }
        }]
    };
    topChart.setOption(option);
}

/* ==============================
   MAIN SUMMARY TABLE
   ============================== */
let tableData = [];

function renderTable(data) {
    const search = document.getElementById('table-search').value.toLowerCase();
    
    const cvsMap = new Map();
    data.forEach(d => {
        const key = d.Area + '_' + d.CanvaserID;
        if (!cvsMap.has(key)) {
            cvsMap.set(key, { 
                area: d.Area, 
                id: d.CanvaserID, 
                name: d.CanvaserName, 
                audit: 0, 
                sysQty: 0,
                sysRp: 0,
                qty: 0, 
                rp: 0, 
                acc: 0 
            });
        }
        const c = cvsMap.get(key);
        const sysStock = d.SystemStock || 0;
        const harga = d.Harga || 0;
        
        c.audit++;
        c.sysQty += sysStock;
        c.sysRp += (sysStock * harga);
        c.qty += d.Selisih;
        c.rp += d.NilaiKerugian;
        if (d.Selisih === 0) c.acc++;
    });

    tableData = Array.from(cvsMap.values()).map(c => {
        c.akurasi = c.audit ? (c.acc / c.audit) * 100 : 0;
        return c;
    }).filter(c => 
        c.area.toLowerCase().includes(search) || 
        c.name.toLowerCase().includes(search) || 
        c.id.toLowerCase().includes(search)
    );

    const avgSelisih = tableData.reduce((sum, c) => sum + (isMetricRp ? c.rp : c.qty), 0) / (tableData.length || 1);

    if (sortConfig.column !== -1) {
        tableData.sort((a, b) => {
            let valA, valB;
            switch(sortConfig.column) {
                case 0: valA = a.area; valB = b.area; break;
                case 1: valA = a.id; valB = b.id; break;
                case 2: valA = a.name; valB = b.name; break;
                case 3: valA = a.audit; valB = b.audit; break;
                case 4: valA = a.sysQty; valB = b.sysQty; break;
                case 5: valA = a.sysRp; valB = b.sysRp; break;
                case 6: valA = a.qty; valB = b.qty; break;
                case 7: valA = a.rp; valB = b.rp; break;
                case 8: valA = a.akurasi; valB = b.akurasi; break;
            }
            if (valA < valB) return sortConfig.asc ? -1 : 1;
            if (valA > valB) return sortConfig.asc ? 1 : -1;
            return 0;
        });
    }

    const tbody = document.getElementById('summary-tbody');
    tbody.innerHTML = '';
    
    tableData.forEach(c => {
        const targetVal = isMetricRp ? c.rp : c.qty;
        const isBad = targetVal > avgSelisih;
        
        let badge = 'good';
        if (c.akurasi < 95) badge = 'warn';
        if (c.akurasi < 85) badge = 'bad';

        const tr = document.createElement('tr');
        if (isBad) tr.classList.add('bg-danger-light');
        tr.style.cursor = 'pointer';
        tr.title = `Klik untuk lihat detail ${c.name}`;
        tr.addEventListener('click', () => openCanvaserDrilldown(c.id, c.name, c.area));
        
        tr.innerHTML = `
            <td>${c.area}</td>
            <td>${c.id}</td>
            <td>${c.name}</td>
            <td>${formatNum(c.audit)}</td>
            <td>${formatNum(c.sysQty)}</td>
            <td>${formatNum(c.sysRp, true)}</td>
            <td class="${isBad && !isMetricRp ? 'text-danger' : ''}">${formatNum(c.qty)}</td>
            <td class="${isBad && isMetricRp ? 'text-danger' : ''}">${formatNum(c.rp, true)}</td>
            <td><span class="badge ${badge}">${c.akurasi.toFixed(1)}%</span></td>
        `;
        tbody.appendChild(tr);
    });
}

function sortTable(colIdx) {
    if (sortConfig.column === colIdx) {
        sortConfig.asc = !sortConfig.asc;
    } else {
        sortConfig.column = colIdx;
        sortConfig.asc = true;
    }
    renderTable(getFilteredData());
}

/* ==============================
   DRILLDOWN / POP-UP PIVOT
   ============================== */
function openDrilldown(productNameSubstring) {
    const data = getFilteredData();
    const searchStr = productNameSubstring.replace('...', '');
    currentDrilldownTransactions = data.filter(d => d.ProductName.includes(searchStr) && d.Selisih > 0)
                             .sort((a, b) => new Date(b.Date) - new Date(a.Date));
    
    document.getElementById('modal-title').textContent = `Histori Selisih Barang: ${currentDrilldownTransactions[0]?.ProductName || productNameSubstring}`;
    document.getElementById('modal-search').value = '';
    allExpanded = false;
    document.getElementById('btn-toggle-all').innerHTML = '<i class="fas fa-expand-arrows-alt"></i> Expand All';
    fillDrilldownTable(currentDrilldownTransactions);
    document.getElementById('drilldown-modal').classList.add('show');
}

function openCanvaserDrilldown(canvaserId, canvaserName, area) {
    const data = getFilteredData();
    currentDrilldownTransactions = data.filter(d => d.CanvaserID === canvaserId && (filters.area === 'all' || d.Area === area))
                             .sort((a, b) => new Date(b.Date) - new Date(a.Date));
    
    document.getElementById('modal-title').textContent = `Detail Transaksi: ${canvaserName} (${canvaserId})`;
    document.getElementById('modal-search').value = '';
    allExpanded = false;
    document.getElementById('btn-toggle-all').innerHTML = '<i class="fas fa-expand-arrows-alt"></i> Expand All';
    fillDrilldownTable(currentDrilldownTransactions);
    document.getElementById('drilldown-modal').classList.add('show');
}

function fillDrilldownTable(transactions, searchFilter = '') {
    const tbody = document.getElementById('drilldown-tbody');
    tbody.innerHTML = '';
    
    const filter = searchFilter ? searchFilter.toLowerCase().trim() : '';

    const groups = new Map();
    transactions.forEach(t => {
        if (filter && !t.ProductName.toLowerCase().includes(filter)) {
            return;
        }

        const key = t.Date + '|||' + t.Area;
        if (!groups.has(key)) {
            groups.set(key, {
                date: t.Date,
                area: t.Area,
                systemQty: 0,
                systemRp: 0,
                physQty: 0,
                selisihQty: 0,
                selisihRp: 0,
                items: []
            });
        }
        const g = groups.get(key);
        const sysStock = t.SystemStock || 0;
        const harga = t.Harga || 0;
        const nominalSistem = sysStock * harga;
        
        g.systemQty += sysStock;
        g.systemRp += nominalSistem;
        g.physQty += (t.PhysicalStock || 0);
        g.selisihQty += (t.Selisih || 0);
        g.selisihRp += (t.NilaiKerugian || 0);
        g.items.push({
            name: t.ProductName,
            systemQty: sysStock,
            systemRp: nominalSistem,
            physQty: t.PhysicalStock || 0,
            selisihQty: t.Selisih || 0,
            selisihRp: t.NilaiKerugian || 0
        });
    });

    if (groups.size === 0) {
        tbody.innerHTML = '<tr><td colspan="8" style="text-align:center; color:#64748b; padding:2rem;">Tidak ada data transaksi yang cocok.</td></tr>';
        return;
    }

    const sortedGroups = Array.from(groups.values()).sort((a, b) => b.date.localeCompare(a.date));

    let grandSistemQty = 0, grandSistemNominal = 0, grandFisikQty = 0, grandSelisihQty = 0, grandSelisihNominal = 0;

    sortedGroups.forEach((g, idx) => {
        const groupId = `group-${idx}`;
        const isExpanded = allExpanded;
        const displayStyle = isExpanded ? 'table-row' : 'none';
        const toggleIcon = isExpanded ? '<i class="fas fa-minus-square" style="color: #64748b;"></i>' : '<i class="fas fa-plus-square" style="color: #2563eb;"></i>';

        grandSistemQty += g.systemQty;
        grandSistemNominal += g.systemRp;
        grandFisikQty += g.physQty;
        grandSelisihQty += g.selisihQty;
        grandSelisihNominal += g.selisihRp;

        // Group summary row
        tbody.innerHTML += `
            <tr id="parent-${groupId}" onclick="toggleModalRow('${groupId}')" style="cursor: pointer; background-color: #f8fafc; border-bottom: 1px solid var(--border-color); font-weight: 600;">
                <td style="text-align: center; font-size: 1.15rem; padding: 0.75rem 0.5rem;" id="icon-${groupId}">${toggleIcon}</td>
                <td style="padding: 0.75rem;">${g.date}</td>
                <td style="padding: 0.75rem;">${g.area}</td>
                <td style="text-align: right; padding: 0.75rem;">${formatNum(g.systemQty)}</td>
                <td style="text-align: right; padding: 0.75rem;">${formatNum(g.systemRp, true)}</td>
                <td style="text-align: right; padding: 0.75rem;">${formatNum(g.physQty)}</td>
                <td style="text-align: right; padding: 0.75rem;" class="${g.selisihQty > 0 ? 'text-danger' : ''}">${formatNum(g.selisihQty)}</td>
                <td style="text-align: right; padding: 0.75rem;" class="${g.selisihRp > 0 ? 'text-danger' : ''}">${formatNum(g.selisihRp, true)}</td>
            </tr>
        `;

        // Render child rows
        g.items.forEach(item => {
            tbody.innerHTML += `
                <tr class="child-${groupId} child-row" style="display: ${displayStyle}; background-color: white; font-size: 0.85rem; color: #475569; border-bottom: 1px dashed #e2e8f0;">
                    <td></td>
                    <td colspan="2" style="padding: 0.5rem 0.75rem 0.5rem 2rem; max-width: 350px; white-space: normal; word-break: break-word;">${item.name}</td>
                    <td style="text-align: right; padding: 0.5rem 0.75rem;">${formatNum(item.systemQty)}</td>
                    <td style="text-align: right; padding: 0.5rem 0.75rem; color: #64748b;">${formatNum(item.systemRp, true)}</td>
                    <td style="text-align: right; padding: 0.5rem 0.75rem;">${formatNum(item.physQty)}</td>
                    <td style="text-align: right; padding: 0.5rem 0.75rem; ${item.selisihQty > 0 ? 'color: var(--danger); font-weight: 600;' : ''}">${formatNum(item.selisihQty)}</td>
                    <td style="text-align: right; padding: 0.5rem 0.75rem; ${item.selisihRp > 0 ? 'color: var(--danger); font-weight: 600;' : ''}">${formatNum(item.selisihRp, true)}</td>
                </tr>
            `;
        });
    });

    // Grand Total Row
    tbody.innerHTML += `
        <tr class="grand-total-row" style="background-color: #e2e8f0 !important; border-top: 2px solid #94a3b8; font-weight: bold; position: sticky; bottom: 0; z-index: 5;">
            <td></td>
            <td colspan="2" style="padding: 0.75rem;"><strong>GRAND TOTAL (Sesuai Filter)</strong></td>
            <td style="text-align: right; padding: 0.75rem;"><strong>${formatNum(grandSistemQty)}</strong></td>
            <td style="text-align: right; padding: 0.75rem;"><strong>${formatNum(grandSistemNominal, true)}</strong></td>
            <td style="text-align: right; padding: 0.75rem;"><strong>${formatNum(grandFisikQty)}</strong></td>
            <td style="text-align: right; padding: 0.75rem;" class="text-danger"><strong>${formatNum(grandSelisihQty)}</strong></td>
            <td style="text-align: right; padding: 0.75rem;" class="text-danger"><strong>${formatNum(grandSelisihNominal, true)}</strong></td>
        </tr>
    `;
}

function onModalSearch() {
    const q = document.getElementById('modal-search').value;
    fillDrilldownTable(currentDrilldownTransactions, q);
}

function toggleModalRow(groupId) {
    const childRows = document.querySelectorAll(`.child-${groupId}`);
    const iconCell = document.getElementById(`icon-${groupId}`);
    
    let isShowing = false;
    childRows.forEach(row => {
        if (row.style.display === 'none') {
            row.style.display = 'table-row';
            isShowing = true;
        } else {
            row.style.display = 'none';
        }
    });

    if (iconCell) {
        iconCell.innerHTML = isShowing 
            ? '<i class="fas fa-minus-square" style="color: #64748b;"></i>' 
            : '<i class="fas fa-plus-square" style="color: #2563eb;"></i>';
    }
}

function toggleAllModalRows() {
    allExpanded = !allExpanded;
    const btn = document.getElementById('btn-toggle-all');
    if (allExpanded) {
        btn.innerHTML = '<i class="fas fa-compress-arrows-alt"></i> Collapse All';
    } else {
        btn.innerHTML = '<i class="fas fa-expand-arrows-alt"></i> Expand All';
    }
    const q = document.getElementById('modal-search').value;
    fillDrilldownTable(currentDrilldownTransactions, q);
}

function closeModal() {
    document.getElementById('drilldown-modal').classList.remove('show');
}

/* ==============================
   EXPORT FUNCTIONS
   ============================== */
function exportCSV() {
    let csv = 'Area,ID Canvaser,Nama Canvaser,Total Audit,Qty Sistem,Sistem Rp,Selisih Qty,Nominal Selisih Rp,Akurasi %\n';
    tableData.forEach(c => {
        csv += `"${c.area}","${c.id}","${c.name}",${c.audit},${c.sysQty},${c.sysRp},${c.qty},${c.rp},${c.akurasi.toFixed(2)}\n`;
    });
    
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", "Stock_Opname_Summary.csv");
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportPDF() {
    window.print();
}

function exportDrilldownExcel() {
    const title = document.getElementById('modal-title').textContent;
    let html = `
        <html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel" xmlns="http://www.w3.org/TR/REC-html40">
        <head>
            <meta http-equiv="content-type" content="application/vnd.ms-excel; charset=UTF-8">
            <style>
                table { border-collapse: collapse; width: 100%; font-family: Arial, sans-serif; }
                th { background-color: #f1f5f9; border: 1px solid #cbd5e1; font-weight: bold; padding: 6px; }
                td { border: 1px solid #e2e8f0; padding: 6px; }
                .group-row { background-color: #f8fafc; font-weight: bold; }
                .child-row { background-color: #ffffff; color: #475569; }
                .grand-total { background-color: #cbd5e1; font-weight: bold; }
                .text-danger { color: #dc2626; font-weight: bold; }
            </style>
        </head>
        <body>
            <h3>${title}</h3>
            <table>
                <thead>
                    <tr>
                        <th>Tanggal</th>
                        <th>Area</th>
                        <th>Barang / Detail</th>
                        <th>Qty Sistem</th>
                        <th>Sistem (RP)</th>
                        <th>Fisik Qty</th>
                        <th>Selisih Qty</th>
                        <th>Selisih (RP)</th>
                    </tr>
                </thead>
                <tbody>
    `;

    const q = document.getElementById('modal-search').value.toLowerCase().trim();
    const groups = new Map();
    
    currentDrilldownTransactions.forEach(t => {
        if (q && !t.ProductName.toLowerCase().includes(q)) return;
        const key = t.Date + '|||' + t.Area;
        if (!groups.has(key)) {
            groups.set(key, { date: t.Date, area: t.Area, systemQty: 0, systemRp: 0, physQty: 0, selisihQty: 0, selisihRp: 0, items: [] });
        }
        const g = groups.get(key);
        const sysStock = t.SystemStock || 0;
        const harga = t.Harga || 0;
        const nominalSistem = sysStock * harga;
        
        g.systemQty += sysStock;
        g.systemRp += nominalSistem;
        g.physQty += (t.PhysicalStock || 0);
        g.selisihQty += (t.Selisih || 0);
        g.selisihRp += (t.NilaiKerugian || 0);
        g.items.push({ name: t.ProductName, systemQty: sysStock, systemRp: nominalSistem, physQty: (t.PhysicalStock || 0), selisihQty: (t.Selisih || 0), selisihRp: (t.NilaiKerugian || 0) });
    });

    let grandSistemQty = 0, grandSistemNominal = 0, grandFisikQty = 0, grandSelisihQty = 0, grandSelisihNominal = 0;

    Array.from(groups.values()).sort((a,b) => b.date.localeCompare(a.date)).forEach(g => {
        grandSistemQty += g.systemQty;
        grandSistemNominal += g.systemRp;
        grandFisikQty += g.physQty;
        grandSelisihQty += g.selisihQty;
        grandSelisihNominal += g.selisihRp;

        html += `
            <tr class="group-row">
                <td>${g.date}</td>
                <td>${g.area}</td>
                <td>RINGKASAN HARIAN</td>
                <td align="right">${g.systemQty}</td>
                <td align="right">${g.systemRp}</td>
                <td align="right">${g.physQty}</td>
                <td align="right" class="${g.selisihQty > 0 ? 'text-danger' : ''}">${g.selisihQty}</td>
                <td align="right" class="${g.selisihRp > 0 ? 'text-danger' : ''}">${g.selisihRp}</td>
            </tr>
        `;

        g.items.forEach(item => {
            html += `
                <tr class="child-row">
                    <td>${g.date}</td>
                    <td>${g.area}</td>
                    <td>${item.name}</td>
                    <td align="right">${item.systemQty}</td>
                    <td align="right">${item.systemRp}</td>
                    <td align="right">${item.physQty}</td>
                    <td align="right" class="${item.selisihQty > 0 ? 'text-danger' : ''}">${item.selisihQty}</td>
                    <td align="right" class="${item.selisihRp > 0 ? 'text-danger' : ''}">${item.selisihRp}</td>
                </tr>
            `;
        });
    });

    html += `
        <tr class="grand-total">
            <td colspan="3">GRAND TOTAL</td>
            <td align="right">${grandSistemQty}</td>
            <td align="right">${grandSistemNominal}</td>
            <td align="right">${grandFisikQty}</td>
            <td align="right" class="text-danger">${grandSelisihQty}</td>
            <td align="right" class="text-danger">${grandSelisihNominal}</td>
        </tr>
        </tbody></table></body></html>
    `;

    const blob = new Blob([html], { type: 'application/vnd.ms-excel;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${title.replace(/[\s\(\):]/g, '_')}_Report.xls`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function exportDrilldownPDF() {
    const title = document.getElementById('modal-title').textContent;
    const tableHTML = document.getElementById('drilldown-table').outerHTML;
    
    const printWindow = window.open('', '_blank');
    if (!printWindow) {
        alert('Popup diblokir oleh browser. Izinkan popup untuk mencetak PDF.');
        return;
    }
    
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>${title}</title>
            <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;700&display=swap" rel="stylesheet">
            <style>
                body { font-family: 'Inter', sans-serif; padding: 25px; color: #1e293b; }
                h2 { margin-bottom: 20px; color: #2563eb; font-size: 1.3rem; }
                table { width: 100%; border-collapse: collapse; margin-top: 10px; font-size: 12px; }
                th, td { padding: 8px; border: 1px solid #cbd5e1; }
                th { background-color: #f8fafc; font-weight: bold; }
                .child-row { display: table-row !important; background-color: white; }
                .grand-total-row { background-color: #e2e8f0 !important; font-weight: bold; }
                .text-danger { color: #dc2626 !important; font-weight: bold; }
                td i { display: none; }
                @media print {
                    @page { size: landscape; margin: 10mm; }
                }
            </style>
        </head>
        <body>
            <h2>${title}</h2>
            ${tableHTML}
            <script>
                document.querySelectorAll('.child-row').forEach(function(r) { r.style.display = 'table-row'; });
                setTimeout(function() {
                    window.print();
                    window.close();
                }, 400);
            </script>
        </body>
        </html>
    `);
    printWindow.document.close();
}

function exportDrilldownHTML() {
    const title = document.getElementById('modal-title').textContent;
    const dataJson = JSON.stringify(currentDrilldownTransactions);

    const fullHtml = '<!DOCTYPE html>\n' +
    '<html lang="id">\n' +
    '<head>\n' +
    '    <meta charset="UTF-8">\n' +
    '    <meta name="viewport" content="width=device-width, initial-scale=1.0">\n' +
    '    <title>' + title + ' - Laporan Interaktif</title>\n' +
    '    <link href="https://fonts.googleapis.com/css2?family=Outfit:wght@300;400;500;600;700;800&display=swap" rel="stylesheet">\n' +
    '    <link rel="stylesheet" href="https://cdnjs.cloudflare.com/ajax/libs/font-awesome/6.4.0/css/all.min.css">\n' +
    '    <style>\n' +
    '        :root { --primary: #4f46e5; --primary-light: #e0e7ff; --bg-gradient: linear-gradient(135deg, #f5f3ff 0%, #e0e7ff 100%); --card-bg: #ffffff; --text-main: #1e1b4b; --border-color: #e0e7ff; --danger: #ef4444; }\n' +
    '        * { margin: 0; padding: 0; box-sizing: border-box; font-family: "Outfit", sans-serif; }\n' +
    '        body { background: var(--bg-gradient); color: var(--text-main); min-height: 100vh; padding: 2rem 1rem; }\n' +
    '        .container { max-width: 1100px; margin: 0 auto; background: var(--card-bg); border-radius: 20px; box-shadow: 0 15px 35px rgba(79, 70, 229, 0.12); border: 1px solid rgba(255,255,255,0.7); overflow: hidden; }\n' +
    '        header { background: linear-gradient(90deg, #4f46e5 0%, #6366f1 100%); padding: 1.75rem 2rem; color: white; display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }\n' +
    '        header h1 { font-size: 1.5rem; font-weight: 800; }\n' +
    '        .toolbar { padding: 1.25rem 2rem; background: #faf5ff; border-bottom: 1px solid var(--border-color); display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; }\n' +
    '        .search-box { position: relative; width: 300px; }\n' +
    '        .search-box i { position: absolute; left: 1rem; top: 50%; transform: translateY(-50%); color: #818cf8; }\n' +
    '        .search-box input { width: 100%; padding: 0.65rem 1rem 0.65rem 2.5rem; border: 2px solid #e0e7ff; border-radius: 10px; font-size: 0.9rem; outline: none; background: white; }\n' +
    '        .btn { padding: 0.6rem 1.2rem; border-radius: 10px; font-size: 0.85rem; font-weight: 600; cursor: pointer; border: none; display: inline-flex; align-items: center; gap: 0.5rem; background: var(--primary); color: white; }\n' +
    '        .btn:hover { opacity: 0.9; }\n' +
    '        table { width: 100%; border-collapse: collapse; }\n' +
    '        th { background: #f5f3ff; padding: 0.85rem 1rem; font-weight: 700; color: #4f46e5; font-size: 0.8rem; text-transform: uppercase; border-bottom: 2px solid var(--border-color); }\n' +
    '        td { padding: 0.85rem 1rem; border-bottom: 1px solid var(--border-color); font-size: 0.9rem; }\n' +
    '        .parent-row { background-color: #ffffff; font-weight: 600; cursor: pointer; }\n' +
    '        .parent-row:hover { background-color: #faf5ff; }\n' +
    '        .child-row { background-color: #fcfbff; font-size: 0.82rem; color: #4b5563; border-bottom: 1px dashed #eef2f6; }\n' +
    '        .grand-total-row { background: linear-gradient(90deg, #e0e7ff 0%, #faf5ff 100%) !important; font-weight: 800; border-top: 2px solid #818cf8; }\n' +
    '        .text-right { text-align: right; }\n' +
    '        .text-danger { color: var(--danger); font-weight: 600; }\n' +
    '    </style>\n' +
    '</head>\n' +
    '<body>\n' +
    '<div class="container">\n' +
    '    <header>\n' +
    '        <div>\n' +
    '            <h1><i class="fas fa-chart-pie"></i> ' + title + '</h1>\n' +
    '            <p style="opacity: 0.85; font-size: 0.85rem; margin-top: 0.25rem;">Laporan Interaktif Stock Opname</p>\n' +
    '        </div>\n' +
    '        <div style="font-size: 0.85rem; opacity: 0.9;">\n' +
    '            Diunduh pada: <span id="download-date"></span>\n' +
    '        </div>\n' +
    '    </header>\n' +
    '    <div class="toolbar">\n' +
    '        <div class="search-box">\n' +
    '            <i class="fas fa-search"></i>\n' +
    '            <input type="text" id="report-search" placeholder="Cari nama barang..." oninput="filterReport()">\n' +
    '        </div>\n' +
    '        <button class="btn" id="btn-toggle-all" onclick="toggleAllRows()"><i class="fas fa-expand-arrows-alt"></i> Expand All</button>\n' +
    '    </div>\n' +
    '    <div style="overflow-x: auto;">\n' +
    '        <table>\n' +
    '            <thead>\n' +
    '                <tr>\n' +
    '                    <th style="width: 45px; text-align: center;"></th>\n' +
    '                    <th style="text-align: left;">Tanggal</th>\n' +
    '                    <th style="text-align: left;">Area</th>\n' +
    '                    <th class="text-right">Qty Sistem</th>\n' +
    '                    <th class="text-right">Sistem (RP)</th>\n' +
    '                    <th class="text-right">Fisik Qty</th>\n' +
    '                    <th class="text-right">Selisih Qty</th>\n' +
    '                    <th class="text-right">Selisih (RP)</th>\n' +
    '                </tr>\n' +
    '            </thead>\n' +
    '            <tbody id="report-tbody"></tbody>\n' +
    '        </table>\n' +
    '    </div>\n' +
    '</div>\n' +
    '<script>\n' +
    '    var transactions = ' + dataJson + ';\n' +
    '    var allExpanded = false;\n' +
    '    document.getElementById("download-date").textContent = new Date().toLocaleString("id-ID");\n' +
    '    function formatNum(num, isRp) {\n' +
    '        if (num === undefined || num === null) return isRp ? "Rp 0" : "0";\n' +
    '        var rounded = Math.round(num);\n' +
    '        var formatted = rounded.toLocaleString("id-ID");\n' +
    '        return isRp ? "Rp " + formatted : formatted;\n' +
    '    }\n' +
    '    function renderReport(search) {\n' +
    '        var tbody = document.getElementById("report-tbody");\n' +
    '        tbody.innerHTML = "";\n' +
    '        var filter = search ? search.toLowerCase().trim() : "";\n' +
    '        var groups = new Map();\n' +
    '        transactions.forEach(function(t) {\n' +
    '            if (filter && !t.ProductName.toLowerCase().includes(filter)) return;\n' +
    '            var key = t.Date + "|||" + t.Area;\n' +
    '            if (!groups.has(key)) {\n' +
    '                groups.set(key, { date: t.Date, area: t.Area, systemQty: 0, systemRp: 0, physQty: 0, selisihQty: 0, selisihRp: 0, items: [] });\n' +
    '            }\n' +
    '            var g = groups.get(key);\n' +
    '            var sys = t.SystemStock || 0;\n' +
    '            var hrg = t.Harga || 0;\n' +
    '            var nom = sys * hrg;\n' +
    '            g.systemQty += sys;\n' +
    '            g.systemRp += nom;\n' +
    '            g.physQty += (t.PhysicalStock || 0);\n' +
    '            g.selisihQty += (t.Selisih || 0);\n' +
    '            g.selisihRp += (t.NilaiKerugian || 0);\n' +
    '            g.items.push({ name: t.ProductName, systemQty: sys, systemRp: nom, physQty: t.PhysicalStock || 0, selisihQty: t.Selisih || 0, selisihRp: t.NilaiKerugian || 0 });\n' +
    '        });\n' +
    '        if (groups.size === 0) {\n' +
    '            tbody.innerHTML = "<tr><td colspan=\\\"8\\\" style=\\\"text-align:center; padding:2.5rem; color:#818cf8;\\\">Tidak ada data yang cocok.</td></tr>";\n' +
    '            return;\n' +
    '        }\n' +
    '        var sortedGroups = Array.from(groups.values()).sort(function(a, b) { return b.date.localeCompare(a.date); });\n' +
    '        var grandSistemQty = 0, grandSistemNominal = 0, grandFisikQty = 0, grandSelisihQty = 0, grandSelisihNominal = 0;\n' +
    '        sortedGroups.forEach(function(g, idx) {\n' +
    '            var groupId = "group-" + idx;\n' +
    '            var displayStyle = allExpanded ? "table-row" : "none";\n' +
    '            var toggleIcon = allExpanded ? "<i class=\\\"fas fa-minus-square\\\" style=\\\"color:#64748b;\\\"></i>" : "<i class=\\\"fas fa-plus-square\\\" style=\\\"color:#4f46e5;\\\"></i>";\n' +
    '            grandSistemQty += g.systemQty;\n' +
    '            grandSistemNominal += g.systemRp;\n' +
    '            grandFisikQty += g.physQty;\n' +
    '            grandSelisihQty += g.selisihQty;\n' +
    '            grandSelisihNominal += g.selisihRp;\n' +
    '            tbody.innerHTML += "<tr class=\\\"parent-row\\\" id=\\\"parent-" + groupId + "\\\" onclick=\\\"toggleRow(\'" + groupId + "\')\\\">" +\n' +
    '                "<td style=\\\"text-align:center; font-size:1.1rem;\\\" id=\\\"icon-" + groupId + "\\\">" + toggleIcon + "</td>" +\n' +
    '                "<td>" + g.date + "</td>" +\n' +
    '                "<td>" + g.area + "</td>" +\n' +
    '                "<td class=\\\"text-right\\\">" + formatNum(g.systemQty) + "</td>" +\n' +
    '                "<td class=\\\"text-right\\\">" + formatNum(g.systemRp, true) + "</td>" +\n' +
    '                "<td class=\\\"text-right\\\">" + formatNum(g.physQty) + "</td>" +\n' +
    '                "<td class=\\\"text-right " + (g.selisihQty > 0 ? "text-danger" : "") + "\\\">" + formatNum(g.selisihQty) + "</td>" +\n' +
    '                "<td class=\\\"text-right " + (g.selisihRp > 0 ? "text-danger" : "") + "\\\">" + formatNum(g.selisihRp, true) + "</td>" +\n' +
    '            "</tr>";\n' +
    '            g.items.forEach(function(item) {\n' +
    '                tbody.innerHTML += "<tr class=\\\"child-row child-" + groupId + "\\\" style=\\\"display:" + displayStyle + ";\\\">" +\n' +
    '                    "<td></td>" +\n' +
    '                    "<td colspan=\\\"2\\\" style=\\\"padding-left:2rem;\\\">" + item.name + "</td>" +\n' +
    '                    "<td class=\\\"text-right\\\">" + formatNum(item.systemQty) + "</td>" +\n' +
    '                    "<td class=\\\"text-right\\\" style=\\\"color:#818cf8;\\\">" + formatNum(item.systemRp, true) + "</td>" +\n' +
    '                    "<td class=\\\"text-right\\\">" + formatNum(item.physQty) + "</td>" +\n' +
    '                    "<td class=\\\"text-right " + (item.selisihQty > 0 ? "text-danger" : "") + "\\\">" + formatNum(item.selisihQty) + "</td>" +\n' +
    '                    "<td class=\\\"text-right " + (item.selisihRp > 0 ? "text-danger" : "") + "\\\">" + formatNum(item.selisihRp, true) + "</td>" +\n' +
    '                "</tr>";\n' +
    '            });\n' +
    '        });\n' +
    '        tbody.innerHTML += "<tr class=\\\"grand-total-row\\\">" +\n' +
    '            "<td></td>" +\n' +
    '            "<td colspan=\\\"2\\\"><strong>GRAND TOTAL</strong></td>" +\n' +
    '            "<td class=\\\"text-right\\\"><strong>" + formatNum(grandSistemQty) + "</strong></td>" +\n' +
    '            "<td class=\\\"text-right\\\"><strong>" + formatNum(grandSistemNominal, true) + "</strong></td>" +\n' +
    '            "<td class=\\\"text-right\\\"><strong>" + formatNum(grandFisikQty) + "</strong></td>" +\n' +
    '            "<td class=\\\"text-right text-danger\\\"><strong>" + formatNum(grandSelisihQty) + "</strong></td>" +\n' +
    '            "<td class=\\\"text-right text-danger\\\"><strong>" + formatNum(grandSelisihNominal, true) + "</strong></td>" +\n' +
    '        "</tr>";\n' +
    '    }\n' +
    '    function toggleRow(groupId) {\n' +
    '        var rows = document.querySelectorAll(".child-" + groupId);\n' +
    '        var icon = document.getElementById("icon-" + groupId);\n' +
    '        var isShowing = false;\n' +
    '        rows.forEach(function(r) {\n' +
    '            if (r.style.display === "none") { r.style.display = "table-row"; isShowing = true; }\n' +
    '            else { r.style.display = "none"; }\n' +
    '        });\n' +
    '        if (icon) {\n' +
    '            icon.innerHTML = isShowing ? "<i class=\\\"fas fa-minus-square\\\" style=\\\"color:#64748b;\\\"></i>" : "<i class=\\\"fas fa-plus-square\\\" style=\\\"color:#4f46e5;\\\"></i>";\n' +
    '        }\n' +
    '    }\n' +
    '    function toggleAllRows() {\n' +
    '        allExpanded = !allExpanded;\n' +
    '        var btn = document.getElementById("btn-toggle-all");\n' +
    '        btn.innerHTML = allExpanded ? "<i class=\\\"fas fa-compress-arrows-alt\\\"></i> Collapse All" : "<i class=\\\"fas fa-expand-arrows-alt\\\"></i> Expand All";\n' +
    '        var searchVal = document.getElementById("report-search").value;\n' +
    '        renderReport(searchVal);\n' +
    '    }\n' +
    '    function filterReport() {\n' +
    '        var searchVal = document.getElementById("report-search").value;\n' +
    '        renderReport(searchVal);\n' +
    '    }\n' +
    '    renderReport();\n' +
    '</script>\n' +
    '</body>\n' +
    '</html>';

    const blob = new Blob([fullHtml], { type: 'text/html;charset=utf-8;' });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${title.replace(/[\s\(\):]/g, '_')}_Report.html`;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}
