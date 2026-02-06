/* ================================================================
   Savvy Sailor Cruises - App
   ================================================================ */

(function () {
    "use strict";

    // --- State ---
    var listings = [];
    var filtered = [];
    var sortCol = "ppn_numeric";
    var sortAsc = true;
    var page = 1;
    var perPage = 50;
    var reportCache = {};

    // --- Data loading ---
    function loadJSON(url) {
        return fetch(url).then(function (r) {
            if (!r.ok) throw new Error(r.status);
            return r.json();
        });
    }

    function init() {
        loadJSON("data/current_listings.json").then(function (data) {
            listings = data.listings || [];
            updateStats(data);
            populateFilters();
            applyFiltersFromURL();
            filterAndRender();
            loadTopDeals();
        }).catch(function (err) {
            document.getElementById("results-body").innerHTML =
                '<tr><td colspan="8" class="loading">Failed to load data. Please try again later.</td></tr>';
        });
    }

    // --- Stats bar ---
    function updateStats(data) {
        document.getElementById("stat-total").textContent = (data.count || 0).toLocaleString();
        var cheapest = listings.reduce(function (min, c) {
            return c.ppn_numeric && (min === null || c.ppn_numeric < min) ? c.ppn_numeric : min;
        }, null);
        document.getElementById("stat-cheapest").textContent = cheapest ? "\u00a3" + cheapest.toFixed(0) : "--";
        if (data.latest_scrape) {
            document.getElementById("stat-updated").textContent = data.latest_scrape;
        }
        // Load price drops count
        loadJSON("data/price_drops.json").then(function (d) {
            document.getElementById("stat-drops").textContent = (d.drops || []).length;
        }).catch(function () {});
    }

    // --- Populate filter dropdowns ---
    function populateFilters() {
        var cruiseLines = {}, categories = {}, types = {}, ports = {}, regions = {};
        listings.forEach(function (c) {
            if (c.cruise_line) cruiseLines[c.cruise_line] = 1;
            if (c.cruise_line_category) categories[c.cruise_line_category] = 1;
            if (c.cruise_type) types[c.cruise_type] = 1;
            if (c.start_port) ports[c.start_port] = 1;
            if (c.region) regions[c.region] = 1;
        });
        fillSelect("filter-cruise-line", Object.keys(cruiseLines).sort());
        fillSelect("filter-category", Object.keys(categories).sort());
        fillSelect("filter-type", Object.keys(types).sort());
        fillSelect("filter-departure-port", Object.keys(ports).sort());
        fillSelect("filter-region", Object.keys(regions).sort());
    }

    function fillSelect(id, items) {
        var sel = document.getElementById(id);
        var current = sel.value;
        while (sel.options.length > 1) sel.remove(1);
        items.forEach(function (item) {
            var opt = document.createElement("option");
            opt.value = item;
            opt.textContent = item;
            sel.appendChild(opt);
        });
        sel.value = current;
    }

    // --- Filtering ---
    function getFilterValues() {
        return {
            search: document.getElementById("filter-search").value.toLowerCase().trim(),
            cruiseLine: document.getElementById("filter-cruise-line").value,
            category: document.getElementById("filter-category").value,
            type: document.getElementById("filter-type").value,
            routeType: document.getElementById("filter-route-type").value,
            departurePort: document.getElementById("filter-departure-port").value,
            region: document.getElementById("filter-region").value,
            minNights: parseInt(document.getElementById("filter-min-nights").value) || 0,
            maxNights: parseInt(document.getElementById("filter-max-nights").value) || 0,
            maxPpn: parseFloat(document.getElementById("filter-max-ppn").value) || 0,
            indicator: document.getElementById("filter-indicator").value
        };
    }

    function applyFilters() {
        var f = getFilterValues();
        filtered = listings.filter(function (c) {
            if (f.search) {
                var hay = [c.cruise_name, c.ship, c.cruise_line, c.start_port, c.end_port,
                    c.destination_string_1, c.destination_string_2, c.region].join(" ").toLowerCase();
                if (hay.indexOf(f.search) === -1) return false;
            }
            if (f.cruiseLine && c.cruise_line !== f.cruiseLine) return false;
            if (f.category && c.cruise_line_category !== f.category) return false;
            if (f.type && c.cruise_type !== f.type) return false;
            if (f.routeType === "circular" && !c.circular) return false;
            if (f.routeType === "one-way" && c.circular) return false;
            if (f.departurePort && c.start_port !== f.departurePort) return false;
            if (f.region && c.region !== f.region) return false;
            if (f.minNights && c.duration_nights < f.minNights) return false;
            if (f.maxNights && c.duration_nights > f.maxNights) return false;
            if (f.maxPpn && c.ppn_numeric && c.ppn_numeric > f.maxPpn) return false;
            if (f.indicator && c.price_indicator !== f.indicator) return false;
            return true;
        });
        sortFiltered();
    }

    function sortFiltered() {
        filtered.sort(function (a, b) {
            var av = a[sortCol], bv = b[sortCol];
            if (av == null && bv == null) return 0;
            if (av == null) return 1;
            if (bv == null) return -1;
            if (sortCol === "departure_date") {
                av = parseDate(av);
                bv = parseDate(bv);
            }
            if (typeof av === "string") {
                var cmp = av.localeCompare(bv);
                return sortAsc ? cmp : -cmp;
            }
            return sortAsc ? av - bv : bv - av;
        });
    }

    function parseDate(s) {
        if (!s) return 0;
        var months = { January: 0, February: 1, March: 2, April: 3, May: 4, June: 5,
            July: 6, August: 7, September: 8, October: 9, November: 10, December: 11 };
        var parts = s.split(" ");
        if (parts.length === 3) {
            return new Date(parseInt(parts[2]), months[parts[1]] || 0, parseInt(parts[0])).getTime();
        }
        return new Date(s).getTime() || 0;
    }

    function filterAndRender() {
        applyFilters();
        page = 1;
        renderTable();
        updateURL();
    }

    // --- Render table ---
    function renderTable() {
        var tbody = document.getElementById("results-body");
        var start = (page - 1) * perPage;
        var slice = filtered.slice(start, start + perPage);
        document.getElementById("results-count").textContent = "(" + filtered.length.toLocaleString() + ")";

        if (slice.length === 0) {
            tbody.innerHTML = '<tr><td colspan="8" class="loading">No cruises match your filters.</td></tr>';
            document.getElementById("pagination").innerHTML = "";
            return;
        }

        var html = "";
        slice.forEach(function (c) {
            var route = c.start_port || "";
            if (c.end_port && c.end_port !== c.start_port) route += " \u2192 " + c.end_port;
            else if (c.circular) route += " (circular)";

            html += '<tr data-id="' + c.cruise_id + '">' +
                '<td class="cruise-name-cell"><span class="cruise-name">' + esc(c.cruise_name) + '</span><span class="cruise-route">' + esc(route) + '</span></td>' +
                '<td>' + esc(c.cruise_line || "") + '</td>' +
                '<td>' + esc(c.ship || "") + '</td>' +
                '<td>' + esc(c.departure_date || "") + '</td>' +
                '<td class="num">' + (c.duration_nights || "") + '</td>' +
                '<td class="num">\u00a3' + (c.ppn_numeric ? c.ppn_numeric.toFixed(2) : "--") + '</td>' +
                '<td class="num">\u00a3' + (c.price_numeric ? c.price_numeric.toLocaleString() : "--") + '</td>' +
                '<td>' + indicatorBadge(c.price_indicator) + '</td>' +
                '</tr>';
        });
        tbody.innerHTML = html;
        renderPagination();
        updateSortArrows();
    }

    function indicatorBadge(ind) {
        var labels = { lowest: "\u25bc Lowest", good: "Good", fair: "Fair", high: "\u25b2 High" };
        return '<span class="indicator indicator-' + (ind || "fair") + '">' + (labels[ind] || "Fair") + '</span>';
    }

    function esc(s) {
        var d = document.createElement("div");
        d.textContent = s;
        return d.innerHTML;
    }

    // --- Pagination ---
    function renderPagination() {
        var totalPages = Math.ceil(filtered.length / perPage);
        if (totalPages <= 1) { document.getElementById("pagination").innerHTML = ""; return; }

        var html = "";
        html += '<button ' + (page <= 1 ? "disabled" : "") + ' data-page="' + (page - 1) + '">&laquo;</button>';

        var start = Math.max(1, page - 3);
        var end = Math.min(totalPages, page + 3);
        if (start > 1) html += '<button data-page="1">1</button><button disabled>...</button>';
        for (var i = start; i <= end; i++) {
            html += '<button data-page="' + i + '" class="' + (i === page ? "active" : "") + '">' + i + '</button>';
        }
        if (end < totalPages) html += '<button disabled>...</button><button data-page="' + totalPages + '">' + totalPages + '</button>';

        html += '<button ' + (page >= totalPages ? "disabled" : "") + ' data-page="' + (page + 1) + '">&raquo;</button>';
        document.getElementById("pagination").innerHTML = html;
    }

    // --- Sort arrows ---
    function updateSortArrows() {
        document.querySelectorAll("#results-table th").forEach(function (th) {
            var arrow = th.querySelector(".sort-arrow");
            if (!arrow) return;
            if (th.getAttribute("data-sort") === sortCol) {
                arrow.textContent = sortAsc ? " \u25b2" : " \u25bc";
            } else {
                arrow.textContent = "";
            }
        });
    }

    // --- Detail Panel ---
    function showDetail(cruiseId) {
        var c = listings.find(function (x) { return x.cruise_id === cruiseId; });
        if (!c) return;

        var panel = document.getElementById("detail-panel");
        var content = document.getElementById("detail-content");

        var priceBar = "";
        if (c.min_price_ever && c.max_price_ever && c.ppn_numeric) {
            var range = c.max_price_ever - c.min_price_ever;
            var pct = range > 0 ? ((c.ppn_numeric - c.min_price_ever) / range * 100) : 50;
            pct = Math.max(0, Math.min(100, pct));
            priceBar = '<div class="price-bar-container">' +
                '<p style="font-size:0.85rem;font-weight:600;margin-bottom:0.3rem;">Price position</p>' +
                '<div class="price-bar-track">' +
                '<div class="price-bar-fill" style="width:' + pct + '%;background:' + (pct < 30 ? 'var(--success)' : pct < 70 ? 'var(--warning)' : 'var(--danger)') + ';"></div>' +
                '</div>' +
                '<div class="price-bar-labels"><span>\u00a3' + c.min_price_ever.toFixed(0) + '/n (min)</span><span>\u00a3' + c.max_price_ever.toFixed(0) + '/n (max)</span></div>' +
                '</div>';
        }

        var indicatorExplain = {
            lowest: "This is at or below the lowest price we've ever tracked for this cruise.",
            good: "This is within 10% of the lowest price we've tracked.",
            fair: "This is 10-40% above the lowest price we've tracked.",
            high: "This is more than 40% above the lowest price we've tracked."
        };

        content.innerHTML =
            '<h2 style="color:var(--primary);margin-bottom:0.5rem;">' + esc(c.cruise_name) + '</h2>' +
            '<div class="detail-price-box">' +
            '<div class="big-price">\u00a3' + (c.ppn_numeric ? c.ppn_numeric.toFixed(2) : "--") + ' <small style="font-size:0.5em;font-weight:400;">per night</small></div>' +
            '<div class="per-night" style="font-size:1.15rem;font-weight:600;margin-top:0.25rem;">\u00a3' + (c.price_numeric ? c.price_numeric.toLocaleString() : "--") + ' total <small style="font-weight:400;">(' + (c.duration_nights || "?") + ' nights)</small></div>' +
            '<div style="margin-top:0.5rem;">' + indicatorBadge(c.price_indicator) + '</div>' +
            '<p style="font-size:0.8rem;color:var(--text-light);margin-top:0.5rem;">' + (indicatorExplain[c.price_indicator] || "") + '</p>' +
            '</div>' +
            priceBar +
            '<div class="detail-grid">' +
            '<div class="detail-section"><h3>Cruise Details</h3>' +
            detailRow("Ship", c.ship) +
            detailRow("Cruise Line", c.cruise_line) +
            detailRow("Category", c.cruise_line_category) +
            detailRow("Type", c.cruise_type) +
            detailRow("Region", c.region) +
            detailRow("Duration", c.duration_nights + " nights") +
            detailRow("Departure", c.departure_date) +
            detailRow("Return", c.end_date) +
            '</div>' +
            '<div class="detail-section"><h3>Route</h3>' +
            detailRow("From", c.start_port) +
            detailRow("To", c.end_port) +
            detailRow("Circular", c.circular ? "Yes" : "No") +
            (c.destination_string_1 ? detailRow("Ports", c.destination_string_1) : "") +
            '<h3 style="margin-top:1rem;">Price History</h3>' +
            detailRow("Current \u00a3/night", "\u00a3" + (c.ppn_numeric ? c.ppn_numeric.toFixed(2) : "--")) +
            detailRow("Min ever \u00a3/night", c.min_price_ever ? "\u00a3" + c.min_price_ever.toFixed(2) : "--") +
            detailRow("Max ever \u00a3/night", c.max_price_ever ? "\u00a3" + c.max_price_ever.toFixed(2) : "--") +
            detailRow("Times tracked", c.times_tracked) +
            detailRow("% vs minimum", c.percent_vs_min > 0 ? "+" + c.percent_vs_min + "%" : "At minimum") +
            '</div></div>' +
            '<div class="detail-links">' +
            '<a href="' + esc(c.details_url || "#") + '" target="_blank" rel="noopener">View on Compare That Cruise</a>' +
            '</div>';

        panel.style.display = "block";
        panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
    }

    function detailRow(label, value) {
        return '<div class="detail-row"><span class="label">' + esc(label) + '</span><span class="value">' + esc(String(value || "--")) + '</span></div>';
    }

    // --- URL query params ---
    function updateURL() {
        var f = getFilterValues();
        var params = new URLSearchParams();
        if (f.search) params.set("q", f.search);
        if (f.cruiseLine) params.set("line", f.cruiseLine);
        if (f.category) params.set("cat", f.category);
        if (f.type) params.set("type", f.type);
        if (f.routeType) params.set("route", f.routeType);
        if (f.departurePort) params.set("port", f.departurePort);
        if (f.region) params.set("region", f.region);
        if (f.minNights) params.set("minn", f.minNights);
        if (f.maxNights) params.set("maxn", f.maxNights);
        if (f.maxPpn) params.set("maxppn", f.maxPpn);
        if (f.indicator) params.set("ind", f.indicator);
        var qs = params.toString();
        history.replaceState(null, "", qs ? "?" + qs : location.pathname);
    }

    function applyFiltersFromURL() {
        var params = new URLSearchParams(location.search);
        if (params.get("q")) document.getElementById("filter-search").value = params.get("q");
        if (params.get("line")) document.getElementById("filter-cruise-line").value = params.get("line");
        if (params.get("cat")) document.getElementById("filter-category").value = params.get("cat");
        if (params.get("type")) document.getElementById("filter-type").value = params.get("type");
        if (params.get("route")) document.getElementById("filter-route-type").value = params.get("route");
        if (params.get("port")) document.getElementById("filter-departure-port").value = params.get("port");
        if (params.get("region")) document.getElementById("filter-region").value = params.get("region");
        if (params.get("minn")) document.getElementById("filter-min-nights").value = params.get("minn");
        if (params.get("maxn")) document.getElementById("filter-max-nights").value = params.get("maxn");
        if (params.get("maxppn")) document.getElementById("filter-max-ppn").value = params.get("maxppn");
        if (params.get("ind")) document.getElementById("filter-indicator").value = params.get("ind");
    }

    // --- Reports ---
    function loadTopDeals() {
        loadJSON("data/top_deals.json").then(function (data) {
            reportCache.topDeals = data;
            renderTopDeals(data, "cheapest_overall");
        }).catch(function () {});
    }

    function renderTopDeals(data, key) {
        var container = document.getElementById("tab-top-deals");
        var tabs = [
            { key: "cheapest_overall", label: "Cheapest Overall" },
            { key: "cheapest_uk_circular", label: "UK Circular" },
            { key: "cheapest_one_way", label: "One-Way" },
            { key: "cheapest_fly_cruise", label: "Fly Cruise" },
            { key: "best_luxury_value", label: "Luxury Value" },
            { key: "biggest_savings", label: "Biggest Savings" }
        ];
        var tabsHtml = '<div class="deal-sub-tabs">';
        tabs.forEach(function (t) {
            tabsHtml += '<button class="deal-sub-tab' + (t.key === key ? " active" : "") + '" data-deal-key="' + t.key + '">' + t.label + '</button>';
        });
        tabsHtml += '</div>';

        var items = data[key] || [];
        var cardsHtml = '<div class="deals-grid">';
        items.forEach(function (d) {
            cardsHtml += '<div class="deal-card" data-cruise-id="' + esc(d.cruise_id) + '" style="cursor:pointer;">' +
                '<div class="deal-name">' + esc(d.cruise_name) + '</div>' +
                '<div class="deal-meta">' + esc(d.ship || "") + ' &middot; ' + esc(d.cruise_line || "") + ' &middot; ' + (d.duration_nights || "") + 'n &middot; ' + esc(d.departure_date || "") + '</div>' +
                '<div class="deal-price">\u00a3' + d.ppn_numeric.toFixed(2) + '<small>/night</small> ' + indicatorBadge(d.price_indicator) + '</div>' +
                (d.details_url ? '<a href="' + esc(d.details_url) + '" target="_blank" rel="noopener" style="font-size:0.8rem;">View deal &rarr;</a>' : "") +
                '</div>';
        });
        cardsHtml += '</div>';
        if (items.length === 0) cardsHtml = '<p class="loading">No deals in this category.</p>';
        container.innerHTML = tabsHtml + cardsHtml;
    }

    function loadPriceDrops() {
        if (reportCache.priceDrops) { renderPriceDrops(reportCache.priceDrops); return; }
        var el = document.getElementById("tab-price-drops");
        el.innerHTML = '<p class="loading">Loading price drops...</p>';
        loadJSON("data/price_drops.json").then(function (data) {
            reportCache.priceDrops = data;
            renderPriceDrops(data);
        }).catch(function () { el.innerHTML = '<p class="loading">Failed to load.</p>'; });
    }

    function renderPriceDrops(data) {
        var drops = (data.drops || []).slice(0, 50);
        var html = "";
        if (drops.length === 0) { html = '<p class="loading">No price drops detected in the latest scrape.</p>'; }
        drops.forEach(function (d) {
            html += '<div class="drop-card" data-cruise-id="' + esc(d.cruise_id) + '" style="cursor:pointer;">' +
                '<div class="drop-info">' +
                '<div class="drop-name">' + esc(d.cruise_name) + '</div>' +
                '<div class="drop-meta">' + esc(d.ship || "") + ' &middot; ' + esc(d.cruise_line || "") + ' &middot; ' + (d.duration_nights || "") + 'n &middot; ' + esc(d.departure_date || "") + '</div>' +
                '<div class="drop-meta">\u00a3' + d.previous_ppn.toFixed(2) + '/n \u2192 \u00a3' + d.current_ppn.toFixed(2) + '/n' +
                (d.details_url ? ' &middot; <a href="' + esc(d.details_url) + '" target="_blank" rel="noopener">View &rarr;</a>' : "") +
                '</div>' +
                '</div>' +
                '<div class="drop-badge">-' + d.drop_percent + '%</div>' +
                '</div>';
        });
        document.getElementById("tab-price-drops").innerHTML = html;
    }

    function loadWhenToBook() {
        if (reportCache.booking) { renderWhenToBook(reportCache.booking); return; }
        var el = document.getElementById("tab-when-to-book");
        el.innerHTML = '<p class="loading">Loading...</p>';
        loadJSON("data/booking_window.json").then(function (data) {
            reportCache.booking = data;
            renderWhenToBook(data);
        }).catch(function () { el.innerHTML = '<p class="loading">Failed to load.</p>'; });
    }

    function renderWhenToBook(data) {
        var windows = data.windows || {};
        var order = ["0-30", "31-60", "61-90", "91-180", "181-365", "366+"];
        var maxPpn = 0;
        order.forEach(function (k) { if (windows[k] && windows[k].avg_ppn > maxPpn) maxPpn = windows[k].avg_ppn; });

        var html = '<h3 style="margin-bottom:1rem;">Average price per night by booking window</h3><div class="chart-container">';
        order.forEach(function (k) {
            var w = windows[k];
            if (!w) return;
            var pct = maxPpn > 0 ? (w.avg_ppn / maxPpn * 100) : 0;
            var color = pct < 50 ? "var(--success)" : pct < 75 ? "var(--warning)" : "var(--danger)";
            html += '<div class="bar-row">' +
                '<span class="bar-label">' + esc(w.label) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
                '<span class="bar-value">\u00a3' + w.avg_ppn.toFixed(0) + '<span class="bar-sample">(n=' + w.sample_size.toLocaleString() + ')</span></span>' +
                '</div>';
        });
        html += '</div>';
        document.getElementById("tab-when-to-book").innerHTML = html;
    }

    function loadSeasonal() {
        if (reportCache.seasonal) { renderSeasonal(reportCache.seasonal); return; }
        var el = document.getElementById("tab-seasonal");
        el.innerHTML = '<p class="loading">Loading...</p>';
        loadJSON("data/seasonal_pricing.json").then(function (data) {
            reportCache.seasonal = data;
            renderSeasonal(data);
        }).catch(function () { el.innerHTML = '<p class="loading">Failed to load.</p>'; });
    }

    function renderSeasonal(data) {
        var months = data.months || {};
        var order = ["January", "February", "March", "April", "May", "June",
            "July", "August", "September", "October", "November", "December"];
        var maxPpn = 0;
        order.forEach(function (m) { if (months[m] && months[m].avg_ppn > maxPpn) maxPpn = months[m].avg_ppn; });

        var html = '<h3 style="margin-bottom:1rem;">Average price per night by departure month</h3><div class="chart-container">';
        order.forEach(function (m) {
            var d = months[m];
            if (!d) return;
            var pct = maxPpn > 0 ? (d.avg_ppn / maxPpn * 100) : 0;
            var color = pct < 50 ? "var(--success)" : pct < 75 ? "var(--warning)" : "var(--danger)";
            html += '<div class="bar-row">' +
                '<span class="bar-label">' + m.slice(0, 3) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + color + ';"></div></div>' +
                '<span class="bar-value">\u00a3' + d.avg_ppn.toFixed(0) + '<span class="bar-sample">(n=' + d.sample_size.toLocaleString() + ')</span></span>' +
                '</div>';
        });
        html += '</div>';
        document.getElementById("tab-seasonal").innerHTML = html;
    }

    function loadByCategory() {
        if (reportCache.categories) { renderByCategory(reportCache.categories); return; }
        var el = document.getElementById("tab-by-category");
        el.innerHTML = '<p class="loading">Loading...</p>';
        loadJSON("data/category_averages.json").then(function (data) {
            reportCache.categories = data;
            renderByCategory(data);
        }).catch(function () { el.innerHTML = '<p class="loading">Failed to load.</p>'; });
    }

    function renderByCategory(data) {
        var cats = data.categories || {};
        var order = ["Budget", "Mid range", "Premium", "Luxury", "Ultra luxury"];
        var maxPpn = 0;
        order.forEach(function (k) { if (cats[k] && cats[k].avg_ppn > maxPpn) maxPpn = cats[k].avg_ppn; });

        var html = '<h3 style="margin-bottom:1rem;">Average price per night by cruise line category</h3><div class="chart-container">';
        order.forEach(function (k) {
            var d = cats[k];
            if (!d) return;
            var pct = maxPpn > 0 ? (d.avg_ppn / maxPpn * 100) : 0;
            var colors = { Budget: "var(--success)", "Mid range": "#4ecdc4", Premium: "var(--warning)", Luxury: "var(--accent)", "Ultra luxury": "var(--danger)" };
            html += '<div class="bar-row">' +
                '<span class="bar-label">' + esc(k) + '</span>' +
                '<div class="bar-track"><div class="bar-fill" style="width:' + pct + '%;background:' + (colors[k] || "var(--primary)") + ';"></div></div>' +
                '<span class="bar-value">\u00a3' + d.avg_ppn.toFixed(0) + '<span class="bar-sample">(n=' + d.sample_size.toLocaleString() + ')</span></span>' +
                '</div>';
        });
        html += '</div>';
        document.getElementById("tab-by-category").innerHTML = html;
    }

    // --- Event Listeners ---
    document.addEventListener("DOMContentLoaded", function () {
        init();

        // Filter inputs
        var filterIds = ["filter-search", "filter-cruise-line", "filter-category", "filter-type",
            "filter-route-type", "filter-departure-port", "filter-region",
            "filter-min-nights", "filter-max-nights", "filter-max-ppn", "filter-indicator"];
        filterIds.forEach(function (id) {
            var el = document.getElementById(id);
            el.addEventListener(el.tagName === "SELECT" ? "change" : "input", debounce(filterAndRender, 250));
        });

        // Clear filters
        document.getElementById("btn-clear-filters").addEventListener("click", function () {
            filterIds.forEach(function (id) { document.getElementById(id).value = ""; });
            filterAndRender();
        });

        // Sort
        document.querySelector("#results-table thead").addEventListener("click", function (e) {
            var th = e.target.closest("th");
            if (!th) return;
            var col = th.getAttribute("data-sort");
            if (!col) return;
            if (sortCol === col) { sortAsc = !sortAsc; } else { sortCol = col; sortAsc = true; }
            sortFiltered();
            page = 1;
            renderTable();
        });

        // Pagination
        document.getElementById("pagination").addEventListener("click", function (e) {
            if (e.target.tagName !== "BUTTON" || e.target.disabled) return;
            page = parseInt(e.target.getAttribute("data-page"));
            renderTable();
            document.querySelector(".results-section").scrollIntoView({ behavior: "smooth" });
        });

        // Row click -> detail
        document.getElementById("results-body").addEventListener("click", function (e) {
            var tr = e.target.closest("tr");
            if (!tr) return;
            var id = tr.getAttribute("data-id");
            if (id) showDetail(id);
        });

        // Close detail
        document.getElementById("detail-close").addEventListener("click", function () {
            document.getElementById("detail-panel").style.display = "none";
        });

        // Report tabs
        document.querySelector(".report-tabs").addEventListener("click", function (e) {
            var btn = e.target.closest(".tab");
            if (!btn) return;
            document.querySelectorAll(".tab").forEach(function (t) { t.classList.remove("active"); });
            btn.classList.add("active");
            var tabId = btn.getAttribute("data-tab");
            document.querySelectorAll(".report-tab-content").forEach(function (t) { t.classList.remove("active"); });
            document.getElementById("tab-" + tabId).classList.add("active");

            // Lazy load
            if (tabId === "price-drops") loadPriceDrops();
            else if (tabId === "when-to-book") loadWhenToBook();
            else if (tabId === "seasonal") loadSeasonal();
            else if (tabId === "by-category") loadByCategory();
        });

        // Deal sub-tabs
        document.getElementById("tab-top-deals").addEventListener("click", function (e) {
            var btn = e.target.closest(".deal-sub-tab");
            if (btn && reportCache.topDeals) {
                renderTopDeals(reportCache.topDeals, btn.getAttribute("data-deal-key"));
                return;
            }
            // Click on deal card -> open detail
            var card = e.target.closest("[data-cruise-id]");
            if (card && !e.target.closest("a")) {
                showDetail(card.getAttribute("data-cruise-id"));
            }
        });

        // Click on price drop card -> open detail
        document.getElementById("tab-price-drops").addEventListener("click", function (e) {
            var card = e.target.closest("[data-cruise-id]");
            if (card && !e.target.closest("a")) {
                showDetail(card.getAttribute("data-cruise-id"));
            }
        });
    });

    function debounce(fn, ms) {
        var timer;
        return function () {
            clearTimeout(timer);
            timer = setTimeout(fn, ms);
        };
    }
})();
