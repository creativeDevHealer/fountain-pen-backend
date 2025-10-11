var axios = require('axios');
var cheerio = require('cheerio');
var express = require('express');
var MongoClient = require('mongodb').MongoClient;
var ObjectId = require('mongodb').ObjectId;
var cron = require('node-cron');
var puppeteer;
var fs = require('fs');


var ebayScrapeConfig = {
    method: 'get',
    url: 'http://api.scrape.do/?url=https%3A%2F%2Fwww.ebay.co.uk%2Fsch%2Fi.html%3F_stpos%3DSK62QN%26_svsrch%3D1%26_nkw%3D%E2%80%9Cmontblanc%E2%80%9D%2Band%2B%E2%80%9C149%E2%80%9D%26LH_TitleDesc%3D1%26_sop%3D10%26LH_PrefLoc%3D2%26_fcid%3D3%26_folent%3D42101235225%26mkevt%3D1%26mkpid%3D0%26emsid%3De11021.m164379.l178259%26mkcid%3D7%26ch%3Dosgood%26euid%3D4467d5740f154c16996dc9a56fcd53bc%26bu%3D43600934330%26ut%3DRU%26exe%3D0%26ext%3D0%26osub%3D-1%7E1%26crd%3D20251008033812%26segname%3D11021&token=e65168739b7543deaba9693ad14d468ff6a220f3e39',
    headers: {
    },
};
var lotArtScrapeConfig = {
    method: 'get',
    url: 'http://api.scrape.do/?url=https%3A%2F%2Fwww.lot-art.com%2Fauction-search%3Fis_ss%3D1%26q%3DMontblanc+149+fountain+pen%26section%3D1%26slo%3D0%26cat%3D%26subcat%3D%26houses%3D%26houses_excl%3D0%26country%3D%26min_price%3D%26max_price%3D%26min_deal_pcnt%3Dnull%26max_deal_pcnt%3Dnull%26currency%3D%26item_type%3D0%26min_create_time%3D0%26order%3Drecent%26context_subcat_only%3D%26context_label3%3D%26context_is_attributed%3D%26context_is_copy%3D%26page%3D1%26res_per_page%3D20%26subq%3D%26context_name_brand%3D%26context_name_brand_birth_death%3D&token=7a4abb5875394052a408c0d3aa07937e8f75f796a2c&output=raw',
    headers: {
    },
};
var carousellScrapeConfig = {
    method: 'get',
    url: 'http://api.scrape.do/?url=https%3A%2F%2Fwww.carousell.sg%2Fsearch%2Fmontblanc+149%3FaddRecent%3Dtrue%26brand_enum%3DBRAND_MONT_BLANC%26canChangeKeyword%3Dtrue%26includeSuggestions%3Dtrue%26sort_by%3D3%26t-search_query_source%3Ddirect_search&token=e65168739b7543deaba9693ad14d468ff6a220f3e39&super=true&geoCode=SG',
    headers: {
    },
};
// Mongo configuration
var MONGO_URI = process.env.MONGO_URI || 'mongodb://localhost:27017/';
var DB_NAME = process.env.DB_NAME || 'products_db';
var COLLECTION_NAME = process.env.COLLECTION_NAME || 'products';

async function saveProductsToMongo(products) {
  if (!Array.isArray(products) || products.length === 0) {
    console.log('No products to save to MongoDB.');
    return;
  }
  var client = new MongoClient(MONGO_URI);
  try {
    await client.connect();
    var db = client.db(DB_NAME);
    var collection = db.collection(COLLECTION_NAME);
    // try {
    //   var delRes = await collection.deleteMany({});
    //   console.log('Cleared MongoDB collection', COLLECTION_NAME, 'deleted', delRes.deletedCount, 'docs');
    // } catch (clearErr) {
    //   console.error('Failed to clear collection', COLLECTION_NAME, clearErr);
    // }
    await collection.createIndex({ link: 1 }, { unique: true });

    var summary = { inserted: 0, updated: 0, skipped: 0, failed: 0 };
    for (var i = 0; i < products.length; i++) {
      var p = products[i];
      var doc = {
        title: (p.title || '').trim(),
        link: (p.productUrl || '').trim(),
        price: (p.price || '').trim(),
        image: (p.imageUrl || '').trim(),
        from: (p.from || '').trim(),
        like: false,
        viewed: false,
        updatedAt: new Date()
      };
      if (!doc.link) {
        summary.skipped += 1;
        continue;
      }
      try {
        var existing = await collection.findOne({ title: doc.title });
        var exsting1 = await collection.findOne({ link: doc.link });
        if (existing && exsting1) {
          await collection.updateOne({ _id: existing._id }, { $set: doc });
          summary.updated += 1;
        } else if(exsting1) {
          await collection.updateOne({ _id: exsting1._id }, { $set: doc });
          summary.updated += 1;
        } else if (existing && existing.from === 'ebay') {
          await collection.updateOne({ _id: exsting._id }, { $set: doc });
          summary.updated += 1;
        } else {
          doc.createdAt = new Date();
          await collection.insertOne(doc);
          summary.inserted += 1;
        }
      } catch (err) {
        summary.failed += 1;
        console.error('Mongo write error for link', doc.link, err);
      }
    }
    console.log('MongoDB save summary:', summary);
  } catch (err) {
    console.error('MongoDB error:', err);
  } finally {
    try { await client.close(); } catch (e) {}
  }
}
var products = [];

async function ebayScrape() {
    return axios(ebayScrapeConfig)
    .then(function (response) {
        var outputPath = 'response.html';
        var content = typeof response.data === 'string' ? response.data : JSON.stringify(response.data, null, 2);
        if (typeof content === 'string') {
        // Try to extract <ul class="srp-results srp-list clearfix"> ... </ul>
        var requiredClasses = ['srp-results', 'srp-list', 'clearfix'];

        function extractTargetUl(html) {
            var re = /<ul\b[^>]*class\s*=\s*(["'])(.*?)\1[^>]*>/ig;
            var match;
            while ((match = re.exec(html)) !== null) {
            var classAttr = match[2] || '';
            var classSet = classAttr.split(/\s+/).reduce(function (acc, cls) {
                if (cls) acc[cls] = true;
                return acc;
            }, {});
            var hasAll = requiredClasses.every(function (cls) { return !!classSet[cls]; });
            if (!hasAll) continue;

            var startIndex = match.index;
            var openTag = match[0];
            var pos = startIndex + openTag.length;
            var depth = 1;
            while (depth > 0) {
                var nextOpen = html.indexOf('<ul', pos);
                var nextClose = html.indexOf('</ul>', pos);
                if (nextClose === -1) break;
                if (nextOpen !== -1 && nextOpen < nextClose) {
                depth += 1;
                pos = nextOpen + 3;
                } else {
                depth -= 1;
                pos = nextClose + 5;
                }
            }
            if (depth === 0) {
                return html.substring(startIndex, pos);
            }
            }
            return null;
        }

        var ulHtml = extractTargetUl(content);
        if (ulHtml) {
            content = ulHtml;
        } else {
            var bodyMatch = content.match(/<body[\s\S]*?>[\s\S]*?<\/body>/i);
            if (bodyMatch && bodyMatch[0]) {
            content = bodyMatch[0];
            } else {
            console.warn('No target <ul> or <body> tag found; saving full content.');
            }
        }
        }

        // Parse and extract products
        try {
        var html = typeof response.data === 'string' ? response.data : '';
        if (!html) {
            console.warn('Response is not HTML string; skipping product extraction.');
            return;
        }
        var $ = cheerio.load(html);

        // Prefer SRP list when present
        var $list = $('ul.srp-results.srp-list.clearfix');
        if ($list.length === 0) {
            $list = $('ul.srp-results');
        }

        function normalizeEbayUrl(u) {
            try {
                if (!u) return '';
                var nofrag = (u.split('#')[0] || '');
                var noquery = (nofrag.split('?')[0] || '');
                // Match patterns like /itm/389080551746 or /itm/Some-Title/389080551746
                var m = noquery.match(/\/itm\/(?:[^\/]+\/)?(\d{6,})/i);
                var originMatch = noquery.match(/^https?:\/\/[^\/]+/i);
                var origin = originMatch ? originMatch[0] : '';
                if (m && m[1] && origin) {
                    return origin + '/itm/' + m[1];
                }
                return noquery;
            } catch (e) { return (u || '').split('?')[0].split('#')[0]; }
        }

        var items = ($list.length ? $list.find('li') : $('li')).toArray();
        items.forEach(function (el) {
            var node = $(el);

            // Heuristic: keep only obvious product cards
            var idAttr = (node.attr('id') || '').trim();
            var hasProductLikeId = /^item[0-9a-f]+$/i.test(idAttr);
            var hasSItemClass = node.hasClass('s-item');
            if (!hasProductLikeId && !hasSItemClass) return; // skip non-product list items

            // Product URL
            var productLink = node.find('a.su-link[href], a.image-treatment[href], a.s-item__link[href]').first();
            var productUrl = (productLink.attr('href') || '').trim();
            if (!productUrl) return;
            if (productUrl.indexOf('/srv/survey/') !== -1) return; // exclude survey/FAQ cards
            if (productUrl.indexOf('/itm/') === -1) return; // must be an item link
            productUrl = normalizeEbayUrl(productUrl);

            // Title
            var titleText = node.find('.s-card__title, .s-item__title, h3, [role="heading"][aria-level] .su-styled-text').first().text().trim();
            if (!titleText) {
            titleText = productLink.text().trim();
            }

            // Image URL (prefer high-res and normalize to s-l500)
            var img = node.find('img').first();
            var imageUrl = (img.attr('data-defer-load') || img.attr('data-src') || img.attr('src') || '').trim();
            if (imageUrl) {
            imageUrl = imageUrl.replace(/\/s-l\d+(\.(?:jpg|jpeg|png|webp))/i, '/s-l500$1');
            }

            // Price
            var priceText = node.find('.s-card__price, .s-item__price, .x-price-primary').first().text().trim();

            // Detail (bid/shipping/other snippets)
            var detailText = node.find('.s-card__attribute-row, .s-item__subtitle, .x-truncate').map(function () {
            return $(this).text().trim();
            }).get().filter(function (t) { return !!t; }).join(' | ');

            products.push({
            title: titleText,
            productUrl: productUrl,
            imageUrl: imageUrl,
            price: priceText,
            detail: detailText,
            from: 'ebay'
            });
        });

        if (products.length === 0) {
            console.warn('No products extracted. The page structure may have changed.');
        }
        } catch (e) {
        console.error('Error during product extraction:', e);
        }
    })
    .catch(function (error) {
        console.log(error);
    });
}
async function lotArtScrape() {
    console.log('Lot Art scraping started');
    return axios(lotArtScrapeConfig)
    .then(function (response) {
        try {
            var html = typeof response.data === 'string' ? response.data : '';
            if (!html) {
                console.warn('Response is not HTML string; skipping product extraction.');
                return;
            }
            var $ = cheerio.load(html);

            // Cards layout: div.col > div.card containing image, title, date, house, estimate
            var cardNodes = $('div.row div.col div.card').toArray();
            var lotArtProducts = [];
            cardNodes.forEach(function (el) {
                var node = $(el);
                var img = node.find('img.card-img-top').first();
                var titleAnchor = node.find('.card-body a.fw-bold').first();

                var titleText = (titleAnchor.text() || img.attr('alt') || '').trim();
                var productUrl = (titleAnchor.attr('href') || node.find('.item-search-result-img-wrapper a').attr('href') || '').trim();
                var imageUrl = (img.attr('src') || '').trim();

                // Date and auction house usually appear as subsequent links in the card body
                var infoLinks = node.find('.card-body a.link-no-underline');
                var dateText = (infoLinks.eq(0).text() || '').trim();
                var houseText = (infoLinks.eq(1).text() || '').trim();

                // Estimate is gated behind login; capture the visible label if present
                var estimateAnchor = node.find('.card-body a[href="/login-register"]').first();
                var estimateText = estimateAnchor.length ? 'Estimate: Login' : '';

                // Price: attempt to detect currency values; fallback to '-'
                var priceText = '';
                var currencyRegex = /(USD|EUR|GBP|CHF|SEK|DKK|JPY|\$|€|£)\s*\d[\d.,]*/i;
                var priceCandidates = [
                    node.find('.price, .lot-price, .estimate, .text-danger, .text-success').first().text(),
                    node.find('.card-body').first().text(),
                    node.text()
                ];
                for (var ci = 0; ci < priceCandidates.length; ci++) {
                    var candidate = (priceCandidates[ci] || '').replace(/\s+/g, ' ').trim();
                    var m = candidate.match(currencyRegex);
                    if (m && m[0]) { priceText = m[0].trim(); break; }
                }
                if (!priceText) priceText = '-';

                if (!productUrl) return; // must have a link to consider as a product card

                lotArtProducts.push({
                    title: titleText,
                    productUrl: productUrl,
                    imageUrl: imageUrl,
                    price: priceText,
                    date: dateText,
                    house: houseText,
                    estimate: estimateText
                });
                products.push({
                    title: titleText,
                    productUrl: productUrl,
                    imageUrl: imageUrl,
                    price: priceText,
                    detail: '',
                    from:'lotArt'
                });
            });

            if (lotArtProducts.length === 0) {
                console.warn('No Lot-Art products extracted. The page structure may have changed.');
            }

            var lines = lotArtProducts.map(function (p, i) {
                return [
                    'Item #' + (i + 1),
                    'Title: ' + p.title,
                    'URL: ' + p.productUrl,
                    'Image: ' + p.imageUrl,
                    'Price: ' + p.price,
                    'Date: ' + p.date,
                    'House: ' + p.house,
                    'Estimate: ' + p.estimate,
                    '---'
                ].join('\n');
            }).join('\n');
        } catch (e) {
            console.error('Error during Lot-Art product extraction:', e);
        }
    })
    .catch(function (error) {
        console.log(error);
    });
}
async function invaluableScrapePage(url) {
    console.log('Invaluable page scraping (Puppeteer) started');
    if (!puppeteer) {
        try { puppeteer = require('puppeteer'); } catch (e) {
            console.error('Puppeteer not installed. Run npm install puppeteer');
            return;
        }
    }
    var browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
        var page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 120000 });

        // Wait for the results container to appear
        await page.waitForSelector('.algolia .hit-wrapper, .search-holder .hit-wrapper, [data-ais-widget="hits"]', { timeout: 60000 });

        var results = await page.evaluate(function () {
            function text(el, sel) {
                var t = el.querySelector(sel);
                return t ? t.textContent.trim() : '';
            }
            function attr(el, sel, name) {
                var t = el.querySelector(sel);
                return t ? (t.getAttribute(name) || '').trim() : '';
            }
            function fixUrl(u) {
                if (!u) return '';
                if (u.indexOf('http') === 0) return u.split('?')[0];
                if (u.indexOf('//') === 0) return 'https:' + u.split('?')[0];
                if (u.charAt(0) !== '/') u = '/' + u;
                return 'https://www.invaluable.com' + u.split('?')[0];
            }
            function fixImg(u) {
                if (!u) return '';
                if (u.indexOf('http') === 0) return u;
                if (u.indexOf('//') === 0) return 'https:' + u;
                if (u.charAt(0) !== '/') u = '/' + u;
                return 'https://image.invaluable.com' + u;
            }
            var items = [];
            var cards = document.querySelectorAll('.hit-wrapper .ais-Hits-list > li, .hit-wrapper .ais-Hits-list .ais-Hits-item, .hit-wrapper [class*="hit"]');
            if (!cards || cards.length === 0) {
                cards = document.querySelectorAll('[data-ais-widget="hits"] li, [data-ais-widget="hits"] .ais-Hits-item');
            }
            cards.forEach(function (c) {
                var link = c.querySelector('a[href*="/auction-lot/"]') || c.querySelector('a[href]');
                var productUrl = link ? fixUrl(link.getAttribute('href') || '') : '';
                var title = link ? (link.getAttribute('title') || link.textContent || '') : '';
                title = (title || text(c, '.lot-title, .lotTitle, h3, h2, .ais-Hits-item a')).trim();
                var imgEl = c.querySelector('img');
                var imageUrl = '';
                if (imgEl) {
                    imageUrl = imgEl.getAttribute('data-src') || imgEl.getAttribute('src') || '';
                    imageUrl = fixImg(imageUrl);
                }
                var price = text(c, '.price, .lot-price, .estimate, .priceResult, .lotEstimate, .lot-price-result');
                if (!productUrl && !title) return;
                items.push({ title: title.trim(), productUrl: productUrl, imageUrl: imageUrl, price: (price || '').trim() });
            });
            return items;
        });

        if (!Array.isArray(results)) results = [];
        results.forEach(function (p) {
            products.push({
                title: p.title || '',
                productUrl: p.productUrl || '',
                imageUrl: p.imageUrl || '',
                price: p.price || '-',
                detail: '',
                from: 'invaluable'
            });
        });
        console.log('Invaluable page extracted ' + results.length + ' product(s).');
    } catch (err) {
        console.error('Invaluable Puppeteer error:', err && (err.message || err));
    } finally {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
    }
}
async function salesroomScrapePage(url) {
    console.log('Salesroom page scraping (Puppeteer) started');
    if (!puppeteer) {
        try { puppeteer = require('puppeteer'); } catch (e) {
            console.error('Puppeteer not installed. Run npm install puppeteer');
            return;
        }
    }
    var browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
        var page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

        // Try to accept cookies if banner is present to ensure results render
        try {
            await new Promise(function (r) { setTimeout(r, 1500); });
            await page.evaluate(function () {
                var buttons = Array.prototype.slice.call(document.querySelectorAll('button, [role="button"], .btn'));
                for (var i = 0; i < buttons.length; i++) {
                    var b = buttons[i];
                    var t = (b.innerText || b.textContent || '').toLowerCase();
                    if (t.includes('accept') || t.includes('agree')) {
                        b.click();
                        break;
                    }
                }
            });
        } catch (e) {}

        // scroll to force lazy load
        async function autoScroll(p) {
            await p.evaluate(async function () {
                await new Promise(function (resolve) {
                    var total = 0;
                    var step = 600;
                    var timer = setInterval(function () {
                        var scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, step);
                        total += step;
                        if (total >= scrollHeight - window.innerHeight - 100) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 200);
                });
            });
        }
        await autoScroll(page);

        // Wait for results anchors to appear (lot links) with robust polling + scroll
        var startTs = Date.now();
        var maxWaitMs = 120000;
        while (Date.now() - startTs < maxWaitMs) {
            var count = await page.evaluate(function () {
                return document.querySelectorAll('a[href*="/en-gb/auction-catalogues/"][href*="/lot-"]').length;
            });
            if (count && count > 0) break;
            await autoScroll(page);
            // click potential "Load more" buttons if present
            try {
                await page.evaluate(function () {
                    var btns = Array.prototype.slice.call(document.querySelectorAll('button, a[role="button"]'));
                    var target = btns.find(function (b) {
                        var t = (b.innerText || b.textContent || '').toLowerCase();
                        return /load\s*more|show\s*more/.test(t);
                    });
                    if (target) target.click();
                });
            } catch (e) {}
            await new Promise(function (r) { setTimeout(r, 1200); });
        }

        var results = await page.evaluate(function () {
            function fixUrl(u) {
                if (!u) return '';
                if (u.indexOf('http') === 0) return u.split('?')[0];
                if (u.indexOf('//') === 0) return 'https:' + u.split('?')[0];
                if (u.charAt(0) !== '/') u = '/' + u;
                return 'https://www.the-saleroom.com' + u.split('?')[0];
            }
            function fixImg(u) {
                if (!u) return '';
                if (u.indexOf('http') === 0) return u;
                if (u.indexOf('//') === 0) return 'https:' + u;
                if (u.charAt(0) !== '/') u = '/' + u;
                return 'https://www.the-saleroom.com' + u;
            }
            function getText(el, selList) {
                for (var i = 0; i < selList.length; i++) {
                    var elFound = el.querySelector(selList[i]);
                    if (elFound && elFound.textContent) return elFound.textContent.trim();
                }
                return '';
            }
            function extractTitle(card, link) {
                var t = '';
                if (link) {
                    t = (link.getAttribute('aria-label') || link.getAttribute('title') || link.textContent || '').trim();
                }
                if (!t || /no\s*image/i.test(t)) {
                    t = getText(card || document, [
                        '[data-testid="lot-title"]',
                        'h3', 'h2', '[class*="title"]', '[itemprop="name"]', '[class*="lot"] a[title]'
                    ]);
                }
                if (!t || /no\s*image/i.test(t)) {
                    var titleNode = (card && card.querySelector('a[href*="/lot-"] span'));
                    if (titleNode && titleNode.textContent) t = titleNode.textContent.trim();
                }
                return (t || '').replace(/\s+/g, ' ').trim();
            }
            function extractPriceRange(card) {
                var txt = getText(card || document, [
                    '[data-testid="price"]',
                    '.price', '[class*="price"]', '[class*="estimate"]', '[itemprop="price"]'
                ]);
                if (!txt) return '';
                txt = txt.replace(/\u00A0/g, ' '); // nbsp
                txt = txt.replace(/[\u2013\u2014\u2212]/g, '-'); // en/em dashes, minus
                txt = txt.replace(/\bto\b/ig, '-');
                txt = txt.replace(/\s+/g, ' ').trim();
                // Remove leading labels like "Estimate"/"Est."/"Guide"
                txt = txt.replace(/^\s*(est(imate)?|guide)[:\s]*/i, '');

                // Currency symbol/code maps
                function normCur(c) {
                    if (!c) return '';
                    c = c.toUpperCase();
                    if (c === '£') return 'GBP';
                    if (c === '€') return 'EUR';
                    if (c === '$') return 'USD';
                    return c;
                }

                // Currency first e.g. "EUR 3,000 - 3,500" or "€ 3,000 - 3,500"
                var mCF = txt.match(/(GBP|USD|EUR|CHF|SEK|DKK|JPY|£|€|\$)\s*(\d[\d.,\s]*)\s*-\s*(\d[\d.,\s]*)/i);
                if (mCF) {
                    var cur1 = normCur(mCF[1]);
                    var low1 = (mCF[2] || '').trim();
                    var high1 = (mCF[3] || '').trim();
                    return (low1 + ' - ' + high1 + (cur1 ? (' ' + cur1) : '')).trim();
                }

                // Range first e.g. "3,000 - 3,500 EUR" or "3,000 - 3,500"
                var mRF = txt.match(/(\d[\d.,\s]*)\s*-\s*(\d[\d.,\s]*)\s*(GBP|USD|EUR|CHF|SEK|DKK|JPY|£|€|\$)?/i);
                if (mRF) {
                    var low2 = (mRF[1] || '').trim();
                    var high2 = (mRF[2] || '').trim();
                    var cur2 = normCur(mRF[3] || '');
                    return (low2 + ' - ' + high2 + (cur2 ? (' ' + cur2) : '')).trim();
                }

                // Single amount with currency
                var mS = txt.match(/(GBP|USD|EUR|CHF|SEK|DKK|JPY|£|€|\$)?\s*(\d[\d.,\s]*)/i);
                if (mS) {
                    var cur3 = normCur(mS[1] || '');
                    var val3 = (mS[2] || '').trim();
                    return (val3 + (cur3 ? (' ' + cur3) : '')).trim();
                }
                return '';
            }
            var items = [];
            var seen = {};
            // Identify containers to exclude (Recently viewed section)
            var excludeRoots = [];
            var headingNodes = Array.prototype.slice.call(document.querySelectorAll('h2, h3, [aria-label]'));
            headingNodes.forEach(function (n) {
                var label = ((n.getAttribute('aria-label') || n.textContent || '') + '').trim().toLowerCase();
                if (label.indexOf('recently viewed') !== -1) {
                    var root = n.closest('section, div, ul, ol') || n.parentElement;
                    if (root) excludeRoots.push(root);
                }
            });
            function isInExcluded(el) {
                for (var i = 0; i < excludeRoots.length; i++) {
                    if (excludeRoots[i].contains(el)) return true;
                }
                return false;
            }
            // Find the main results container by picking the ancestor with the most lot links
            var allLotAnchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/en-gb/auction-catalogues/"][href*="/lot-"]'));
            var containerCount = new Map();
            function keyFor(el) { return (el && el.outerHTML ? el.outerHTML.slice(0, 200) : String(el)); }
            allLotAnchors.forEach(function (a) {
                if (isInExcluded(a)) return;
                var container = a.closest('[data-testid*="results" i], [data-testid*="grid" i], main, section, .results, [class*="results"], [class*="grid"]') || document.body;
                var k = keyFor(container);
                containerCount.set(k, { el: container, count: (containerCount.get(k)?.count || 0) + 1 });
            });
            var best = null; var bestCount = -1;
            containerCount.forEach(function (v) { if (v.count > bestCount) { best = v.el; bestCount = v.count; } });
            var root = best || document;
            // Optional: limit to displayed items count if visible
            var declaredCount = 0;
            try {
                var labelNode = Array.prototype.slice.call(document.querySelectorAll('*')).find(function (n) {
                    var t = (n.textContent || '').trim();
                    return /(\d+)\s+items/i.test(t);
                });
                if (labelNode) {
                    var m = (labelNode.textContent || '').match(/(\d+)\s+items/i);
                    if (m) declaredCount = parseInt(m[1], 10);
                }
            } catch (e) {}
            var anchors = Array.prototype.slice.call(root.querySelectorAll('a[href*="/en-gb/auction-catalogues/"][href*="/lot-"]'));
            anchors.forEach(function (a) {
                var href = (a.getAttribute('href') || '').trim();
                if (!/\/lot-/i.test(href)) return; // must reference a lot link
                var productUrl = fixUrl(href);
                if (seen[productUrl]) return;
                if (isInExcluded(a)) return; // skip recently viewed
                seen[productUrl] = true;

                // attempt to find the card container for better context
                var card = a.closest('li, article, [data-testid="lot-card"], .lot, .card, .card-container') || a.parentElement;
                var title = extractTitle(card, a);
                var imgEl = (card && (card.querySelector('img[loading], img[src], img[data-src]'))) || a.querySelector('img') || document.querySelector('img');
                var imageUrl = '';
                if (imgEl) {
                    imageUrl = imgEl.getAttribute('data-src') || imgEl.getAttribute('data-original') || imgEl.getAttribute('src') || '';
                    imageUrl = fixImg(imageUrl);
                }
                var price = extractPriceRange(card);
                items.push({ title: title, productUrl: productUrl, imageUrl: imageUrl, price: price });
            });
            if (declaredCount && items.length > declaredCount) {
                items = items.slice(0, declaredCount);
            }
            return items;
        });

        // if (!Array.isArray(results)) results = [];
        // var lines = results.map(function (p, i) {
        //     return [
        //         'Item #' + (i + 1),
        //         'Title: ' + (p.title || ''),
        //         'URL: ' + (p.productUrl || ''),
        //         'Image: ' + (p.imageUrl || ''),
        //         'Price: ' + ((p.price || '').trim() || '-'),
        //         '---'
        //     ].join('\n');
        // }).join('\n');
        // fs.writeFileSync('salesroom_products.txt', lines, 'utf8');

        results.forEach(function (p) {
            products.push({
                title: (p.title || '').trim(),
                productUrl: p.productUrl || '',
                imageUrl: p.imageUrl || '',
                price: ((p.price || '').trim() || '-'),
                detail: '',
                from: 'salesroom'
            });
        });
        console.log('Salesroom page extracted ' + results.length + ' product(s).');
    } catch (err) {
        console.error('Salesroom Puppeteer error:', err && (err.message || err));
    } finally {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
    }
}
async function carousellScrape(){
   await axios(carousellScrapeConfig)
    .then(function (response) {
        var data = response && response.data;
        var isHtml = typeof data === 'string';
        var content = isHtml ? data : JSON.stringify(data || {}, null, 2);
        // var filename = isHtml ? 'carousell_response.html' : 'carousell_response.json';
        // fs.writeFile(filename, content, 'utf8', function (err) {
        //     if (err) {
        //         console.log('Failed to save response:', err);
        //     } else {
        //         console.log('Saved response to ' + filename);
        //     }
        // });

        // Attempt to extract product data directly from the response
        try {
            var html = isHtml ? content : '';
            var extracted = [];
            if (html) {
                var $ = cheerio.load(html);
                // Prefer product anchors linking to /p/... (Carousell listing pages)
                var seenHref = {};
                $('a[href*="/p/"]').each(function () {
                    var a = $(this);
                    var href = (a.attr('href') || '').trim();
                    if (!href) return;
                    if (seenHref[href]) return; // de-dupe
                    seenHref[href] = true;

                    function absolute(u) {
                        if (!u) return '';
                        if (/^https?:\/\//i.test(u)) return u;
                        if (u.indexOf('//') === 0) return 'https:' + u;
                        if (u.charAt(0) !== '/') u = '/' + u;
                        return 'https://www.carousell.sg' + u;
                    }

                    var productUrl = absolute(href);

                    var title = (a.attr('aria-label') || '').trim();
                    if (!title) title = (a.find('img').attr('alt') || '').trim();
                    if (!title) title = (a.text() || '').replace(/\s+/g, ' ').trim();

                    var img = a.find('img').first();
                    var imageUrl = (img.attr('src') || img.attr('data-src') || '').trim();
                    if (!imageUrl) {
                        var srcset = (a.find('source').attr('srcset') || '').trim();
                        if (srcset) imageUrl = srcset.split(/\s+/)[0];
                    }
                    imageUrl = absolute(imageUrl);

                    // Find a nearby price text in the same card
                    var card = a.closest('article, li, div');
                    var priceText = '';
                    if (card && card.length) {
                        var txt = card.text() || '';
                        var m = txt.match(/(?:SGD|USD|EUR|MYR|PHP|RM|₱|S\$|\$|€|£)\s?\d[\d.,]*/);
                        priceText = m ? m[0].trim() : '';
                    }
                    extracted.push({
                        title: title,
                        productUrl: productUrl,
                        imageUrl: imageUrl,
                        price: priceText || '-'
                    });
                });
            }

            if (extracted.length === 0 && !isHtml) {
                // Fallback: try JSON structure if present
                try {
                    var json = data || {};
                    // Heuristic search for arrays with listing-like objects
                    function walk(node) {
                        if (!node) return;
                        if (Array.isArray(node)) {
                            node.forEach(walk);
                            return;
                        }
                        if (typeof node === 'object') {
                            var keys = Object.keys(node);
                            if (keys.includes('title') && (keys.includes('price') || keys.includes('pricing'))) {
                                var title = (node.title || '').toString();
                                var url = (node.url || node.permalink || node.slug || '').toString();
                                var img = (node.image || node.imageUrl || node.thumbnail || '').toString();
                                extracted.push({
                                    title: title,
                                    productUrl: url,
                                    imageUrl: img,
                                    price: (node.price || node.pricing || '-').toString()
                                });
                            }
                            keys.forEach(function (k) { walk(node[k]); });
                        }
                    }
                    walk(json);
                } catch (e2) {}
            }

            if (extracted.length) {
                // var lines = extracted.map(function (p, i) {
                //     return [
                //         'Item #' + (i + 1),
                //         'Title: ' + (p.title || ''),
                //         'URL: ' + (p.productUrl || ''),
                //         'Image: ' + (p.imageUrl || ''),
                //         'Price: ' + (p.price || '-'),
                //         '---'
                //     ].join('\n');
                // }).join('\n');
                // fs.writeFile('carousell_products.txt', lines, 'utf8', function (err2) {
                //     if (err2) {
                //         console.log('Failed to write carousell_products.txt:', err2);
                //     } else {
                //         console.log('Extracted ' + extracted.length + ' product(s) to carousell_products.txt');
                //     }
                // });

                extracted.forEach(function (p) {
                    products.push({
                        title: (p.title || '').trim(),
                        productUrl: (p.productUrl || '').trim(),
                        imageUrl: (p.imageUrl || '').trim(),
                        price: (p.price || '-').trim(),
                        detail: '',
                        from: 'carousell'
                    });
                });
                console.log('Carousell page extracted ' + extracted.length + ' product(s).');
            } else {
                console.log('No Carousell products extracted from the response.');
            }
        } catch (parseErr) {
            console.log('Carousell parse error:', parseErr && (parseErr.message || parseErr));
        }
    })
    .catch(function (error) {
        console.log(error);
    });
}

// Scrape Dylan Stephen search results using Puppeteer
async function dylanStephenScrapePage(url) {
    console.log('Dylan Stephen scraping (Puppeteer) started');
    if (!puppeteer) {
        try { puppeteer = require('puppeteer'); } catch (e) {
            console.error('Puppeteer not installed. Run npm install puppeteer');
            return;
        }
    }
    var browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
        var page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
        await new Promise(function (r) { setTimeout(r, 1500); });

        // Attempt to accept cookie banner if present
        try {
            await page.waitForTimeout(1200);
            await page.evaluate(function () {
                var btns = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"]'));
                var accept = btns.find(function (b) {
                    var t = ((b.innerText || b.textContent || '') + '').toLowerCase();
                    return /accept|agree|consent/.test(t);
                });
                if (accept) accept.click();
            });
        } catch (e) {}

        // Wait for product grid (broad conditions)
        try {
            await page.waitForFunction(function () {
                return document.querySelectorAll('ul.products li.product, .products .product, .woocommerce ul.products a[href*="/product/"]').length > 0
                    || document.querySelectorAll('a[href*="/product/"] , h2.woocommerce-loop-product__title, .woocommerce-loop-product__title').length > 0
                    || document.querySelectorAll('article, .post').length > 0;
            }, { timeout: 90000 });
        } catch (e) {
            console.warn('Dylan Stephen: primary wait timed out, proceeding with best-effort extraction');
        }

        // Scroll to bottom to load lazy assets
        async function autoScroll(p) {
            await p.evaluate(async function () {
                await new Promise(function (resolve) {
                    var total = 0;
                    var step = 600;
                    var timer = setInterval(function () {
                        var scrollHeight = document.body.scrollHeight;
                        window.scrollBy(0, step);
                        total += step;
                        if (total >= scrollHeight - window.innerHeight - 100) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 200);
                });
            });
        }
        await autoScroll(page);

        var results = await page.evaluate(function () {
            function abs(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                if (u.indexOf('//') === 0) return 'https:' + u;
                if (u.charAt(0) !== '/') u = '/' + u;
                return window.location.origin + u;
            }
            function text(el, sel) {
                var n = el.querySelector(sel);
                return n ? (n.textContent || '').trim() : '';
            }
            function textFrom(root, selectors) {
                for (var i = 0; i < selectors.length; i++) {
                    var n = root.querySelector(selectors[i]);
                    if (n && n.textContent) {
                        var t = n.textContent.replace(/\s+/g, ' ').trim();
                        if (t && t.length > 2 && !/^\W+$/.test(t)) return t;
                    }
                }
                return '';
            }
            function imgSrc(el) {
                var img = el.querySelector('img');
                if (!img) return '';
                return (img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || '').trim();
            }
            function titleFrom(node, a) {
                // 1) attributes on anchor
                var t = (a && (a.getAttribute('title') || a.getAttribute('aria-label'))) || '';
                if (t) return t.replace(/\s+/g, ' ').trim();
                // 2) explicit title nodes
                t = textFrom(node, ['.woocommerce-loop-product__title', '.product-title', 'h2.woocommerce-loop-product__title', 'h2', 'h3']);
                if (t) return t;
                // 3) img alt
                var img = node.querySelector('img');
                if (img) {
                    var alt = (img.getAttribute('alt') || '').trim();
                    if (alt && alt.length > 2) return alt;
                }
                // 4) anchor text (filter out lone symbols like + or *)
                if (a && a.textContent) {
                    var at = a.textContent.replace(/\s+/g, ' ').trim();
                    if (at && at.length > 2 && !/^\W+$/.test(at)) return at;
                }
                return '';
            }

            var items = [];
            var nodes = document.querySelectorAll('ul.products li.product, .products li.product, li.product');
            if (!nodes || nodes.length === 0) {
                // Fallback: search generic anchors if Woo selectors not present
                nodes = document.querySelectorAll('article, .post, .entry, .content');
            }
            nodes.forEach(function (node) {
                var a = node.querySelector('a.woocommerce-LoopProduct-link, a.woocommerce-loop-product__link, a[href*="/product/"]') || node.querySelector('a[href]');
                var productUrl = a ? abs(a.getAttribute('href') || '') : '';
                var title = titleFrom(node, a);
                var price = text(node, '.price, .woocommerce-Price-amount, .amount');
                var img = imgSrc(node);
                if (!productUrl && !title) return;
                items.push({ title: title || '', productUrl: productUrl || '', imageUrl: img || '', price: (price || '').trim() || '-' });
            });
            return items;
        });

        if (!Array.isArray(results)) results = [];
        results.forEach(function (p) {
            products.push({
                title: p.title || '',
                productUrl: p.productUrl || '',
                imageUrl: p.imageUrl || '',
                price: p.price || '-',
                detail: '',
                from: 'dylanStephen'
            });
        });
        console.log('Dylan Stephen extracted ' + results.length + ' product(s).');
    } catch (err) {
        console.error('Dylan Stephen Puppeteer error:', err && (err.message || err));
    } finally {
        if (browser) {
            try { await browser.close(); } catch (e) {}
        }
    }
}

// Scrape Pen Lover Boutique (Shopify) search results using Puppeteer
async function penLoverBoutiqueScrapePage(url) {
    console.log('Pen Lover Boutique scraping (Puppeteer) started');
    if (!puppeteer) {
        try { puppeteer = require('puppeteer'); } catch (e) {
            console.error('Puppeteer not installed. Run npm install puppeteer');
            return;
        }
    }
    var browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
        var page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit(537.36) Chrome/118 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });

        // Wait for product links to be present
        await page.waitForSelector('a[href*="/products/"]', { timeout: 60000 });

        // Scroll to load images if lazy
        async function autoScroll(p) {
            await p.evaluate(async function () {
                await new Promise(function (resolve) {
                    var total = 0;
                    var step = 600;
                    var timer = setInterval(function () {
                        var sh = document.body.scrollHeight;
                        window.scrollBy(0, step);
                        total += step;
                        if (total >= sh - window.innerHeight - 100) {
                            clearInterval(timer);
                            resolve();
                        }
                    }, 200);
                });
            });
        }
        await autoScroll(page);

        var results = await page.evaluate(function () {
            function abs(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                if (u.indexOf('//') === 0) return 'https:' + u;
                if (u.charAt(0) !== '/') u = '/' + u;
                return window.location.origin + u;
            }
            function textFrom(root, selectors) {
                for (var i = 0; i < selectors.length; i++) {
                    var n = root.querySelector(selectors[i]);
                    if (n && n.textContent) return n.textContent.replace(/\s+/g, ' ').trim();
                }
                return '';
            }
            function getPrice(root) {
                var selectors = [
                    '.price__sale .price-item--sale',
                    '.price-item--regular',
                    '.price__regular .price-item',
                    '.price',
                    '.money',
                ];
                for (var i = 0; i < selectors.length; i++) {
                    var n = root.querySelector(selectors[i]);
                    if (n && n.textContent) return n.textContent.replace(/\s+/g, ' ').trim();
                }
                // Fallback: search for currency symbols
                var txt = (root.textContent || '').replace(/\s+/g, ' ').trim();
                var m = txt.match(/(€|EUR|£|GBP|\$|USD)\s?\d[\d.,]*/);
                return m ? m[0] : '-';
            }
            function imgSrc(root) {
                var img = root.querySelector('img');
                if (!img) return '';
                var srcset = (img.getAttribute('data-srcset') || img.getAttribute('srcset') || '').trim();
                if (srcset) {
                    var first = (srcset.split(',')[0] || '').trim();
                    var url = first.split(' ')[0] || '';
                    return url;
                }
                return (img.getAttribute('data-src') || img.getAttribute('data-original') || img.getAttribute('src') || '').trim();
            }

            var items = [];
            // Product cards often wrapped in li or div; we traverse anchors and build unique cards
            var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/products/"]'));
            var seen = {};
            anchors.forEach(function (a) {
                var href = a.getAttribute('href') || '';
                if (!href || seen[href]) return;
                seen[href] = true;
                var card = a.closest('li, article, .card, .product-item, .grid__item, .product, .card-wrapper') || a;
                var title = (a.getAttribute('title') || textFrom(card || a, ['.full-unstyled-link', '.card__heading a', '.card__heading', '.card-information__text', '.product-title', 'h3', 'h2']));
                if (!title) {
                    var imgAlt = (card && card.querySelector('img')) ? (card.querySelector('img').getAttribute('alt') || '') : '';
                    if (imgAlt) title = imgAlt.trim();
                }
                if (!title) title = (a.textContent || '').replace(/\s+/g, ' ').trim();
                var price = getPrice(card || a);
                var img = imgSrc(card || a);
                items.push({ title: title, productUrl: abs(href), imageUrl: abs(img), price: price });
            });
            return items;
        });

        if (!Array.isArray(results)) results = [];
        results.forEach(function (p) {
            products.push({
                title: p.title || '',
                productUrl: p.productUrl || '',
                imageUrl: p.imageUrl || '',
                price: p.price || '-',
                detail: '',
                from: 'penLoverBoutique'
            });
        });
        console.log('Pen Lover Boutique extracted ' + results.length + ' product(s).');
    } catch (err) {
        console.error('Pen Lover Boutique Puppeteer error:', err && (err.message || err));
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
    }
}

// Scrape Vintage and Modern Pens search results (WordPress)
async function vintageAndModernPensScrapePage(url) {
    console.log('Vintage & Modern Pens scraping (Puppeteer) started');
    if (!puppeteer) {
        try { puppeteer = require('puppeteer'); } catch (e) {
            console.error('Puppeteer not installed. Run npm install puppeteer');
            return;
        }
    }
    var browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
        var page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('article, .post, h2 a', { timeout: 60000 });
        var results = await page.evaluate(function () {
            function abs(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                if (u.indexOf('//') === 0) return 'https:' + u;
                if (u.charAt(0) !== '/') u = '/' + u;
                return window.location.origin + u;
            }
            function extractPrice(txt) {
                var m = (txt || '').replace(/\s+/g, ' ').match(/(£|GBP|€|EUR|\$|USD)\s?\d[\d.,]*/i);
                return m ? m[0] : '-';
            }
            var items = [];
            var posts = Array.prototype.slice.call(document.querySelectorAll('article, .post'));
            posts.forEach(function (p) {
                var a = p.querySelector('h2 a, h1 a, a[href]');
                var href = a ? a.getAttribute('href') : '';
                var title = a ? (a.textContent || '').trim() : '';
                if (!href && !title) return;
                var img = (p.querySelector('img') && (p.querySelector('img').getAttribute('src') || p.querySelector('img').getAttribute('data-src'))) || '';
                var price = extractPrice(p.textContent || '');
                items.push({ title: title, productUrl: abs(href), imageUrl: abs(img), price: price });
            });
            // Also look for older entries pagination blocks if present
            if (items.length === 0) {
                var anchors = Array.prototype.slice.call(document.querySelectorAll('h2 a[href]'));
                anchors.forEach(function (a) {
                    var href = a.getAttribute('href') || '';
                    var title = (a.textContent || '').trim();
                    if (!href || !title) return;
                    items.push({ title: title, productUrl: abs(href), imageUrl: '', price: '-' });
                });
            }
            return items;
        });
        (results || []).forEach(function (p) {
            products.push({ title: p.title || '', productUrl: p.productUrl || '', imageUrl: p.imageUrl || '', price: p.price || '-', detail: '', from: 'vintageAndModernPens' });
        });
        console.log('Vintage & Modern Pens extracted ' + (results ? results.length : 0) + ' product(s).');
    } catch (err) {
        console.error('Vintage & Modern Pens Puppeteer error:', err && (err.message || err));
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
    }
}

// Scrape Catawiki search results
async function catawikiScrapePage(url) {
    console.log('Catawiki scraping (Puppeteer) started');
    if (!puppeteer) {
        try { puppeteer = require('puppeteer'); } catch (e) {
            console.error('Puppeteer not installed. Run npm install puppeteer');
            return;
        }
    }
    var browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
        var page = await browser.newPage();
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 120000 });
        await page.waitForSelector('a[href*="/en/l/"]', { timeout: 60000 });
        var results = await page.evaluate(function () {
            function abs(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                if (u.indexOf('//') === 0) return 'https:' + u;
                if (u.charAt(0) !== '/') u = '/' + u;
                return window.location.origin + u.split('?')[0];
            }
            var items = [];
            var anchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/en/l/"]'));
            var seen = {};
            anchors.forEach(function (a) {
                var href = a.getAttribute('href') || '';
                if (!href || seen[href]) return; seen[href] = true;
                var card = a.closest('article, li, div');
                var title = (a.getAttribute('title') || (card && card.querySelector('[data-testid], h3, h2, .title'))?.textContent || a.textContent || '').replace(/\s+/g, ' ').trim();
                var img = '';
                var imgEl = (card && card.querySelector('img')) || a.querySelector('img');
                if (imgEl) img = imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '';
                items.push({ title: title, productUrl: abs(href), imageUrl: abs(img), price: '-' });
            });
            return items;
        });
        (results || []).forEach(function (p) {
            products.push({ title: p.title || '', productUrl: p.productUrl || '', imageUrl: p.imageUrl || '', price: p.price || '-', detail: '', from: 'catawiki' });
        });
        console.log('Catawiki extracted ' + (results ? results.length : 0) + ' product(s).');
    } catch (err) {
        console.error('Catawiki Puppeteer error:', err && (err.message || err));
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
    }
}

// Scrape Milanuncios search results
async function milanunciosScrapePage(url) {
    console.log('Milanuncios scraping (Puppeteer) started');
    if (!puppeteer) {
        try { puppeteer = require('puppeteer'); } catch (e) {
            console.error('Puppeteer not installed. Run npm install puppeteer');
            return;
        }
    }
    var browser;
    try {
        browser = await puppeteer.launch({ headless: 'new', args: ['--no-sandbox','--disable-setuid-sandbox'] });
        var page = await browser.newPage();
        try { await page.setExtraHTTPHeaders({ 'Accept-Language': 'es-ES,es;q=0.9,en;q=0.8' }); } catch (e) {}
        await page.setUserAgent('Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/118.0.0.0 Safari/537.36');
        await page.setViewport({ width: 1366, height: 900 });
        await page.goto(url, { waitUntil: 'networkidle2', timeout: 180000 });
        await new Promise(function (r) { setTimeout(r, 1500); });
        // cookie/consent banner handling
        try {
            await page.evaluate(function () {
                var btns = Array.prototype.slice.call(document.querySelectorAll('button, a, [role="button"]'));
                var accept = btns.find(function (b) {
                    var t = ((b.innerText || b.textContent || '') + '').toLowerCase();
                    return /aceptar|accept|agree|consent/.test(t);
                });
                if (accept) accept.click();
            });
        } catch (e) {}
        // broader waiting condition
        try {
            await page.waitForFunction(function () {
                return document.querySelectorAll('[class*="AdCard"], a[href*="/anuncios/"], article a[href]').length > 0;
            }, { timeout: 90000 });
        } catch (e) {
            console.warn('Milanuncios: primary wait timed out, proceeding with best-effort extraction');
        }
        var results = await page.evaluate(function () {
            function abs(u) {
                if (!u) return '';
                if (/^https?:\/\//i.test(u)) return u;
                if (u.indexOf('//') === 0) return 'https:' + u;
                if (u.charAt(0) !== '/') u = '/' + u;
                return window.location.origin + u.split('?')[0];
            }
            function priceFrom(el) {
                var txt = (el.textContent || '').replace(/\s+/g, ' ');
                // Try explicit selectors first
                var sel = el.querySelector('[class*="price" i], [data-testid*="price" i]');
                if (sel && sel.textContent) txt = sel.textContent.replace(/\s+/g, ' ');
                var m = txt.match(/(€|EUR|£|GBP|\$|USD)\s?\d[\d.,]*/);
                return m ? m[0] : '-';
            }
            var items = [];
            var cards = Array.prototype.slice.call(document.querySelectorAll('[class*="AdCard"], article, li'));
            var anchors = [];
            if (cards.length) {
                cards.forEach(function (c) {
                    var a = c.querySelector('a[href*="/anuncios/"]') || c.querySelector('a[href]');
                    if (a) anchors.push(a);
                });
            } else {
                anchors = Array.prototype.slice.call(document.querySelectorAll('a[href*="/anuncios/"], article a[href]'));
            }
            var seen = {};
            anchors.forEach(function (a) {
                var href = a.getAttribute('href') || '';
                if (!href || seen[href]) return; seen[href] = true;
                var card = a.closest('[class*="AdCard"], article, li, .aditem, .ma-AdCard-body, .ma-AdCard') || a;
                var titleNode = (card && (card.querySelector('.ma-AdCard-title, [class*="AdCard-title"], h2, h3'))) || null;
                var title = (a.getAttribute('title') || (titleNode && titleNode.textContent) || a.textContent || '').replace(/\s+/g, ' ').trim();
                if (title && title.length <= 2) title = '';
                var imgEl = (card && card.querySelector('img')) || a.querySelector('img');
                var img = '';
                if (imgEl) {
                    var ss = (imgEl.getAttribute('srcset') || imgEl.getAttribute('data-srcset') || '').trim();
                    if (ss) img = (ss.split(',')[0] || '').trim().split(' ')[0] || '';
                    if (!img) img = (imgEl.getAttribute('src') || imgEl.getAttribute('data-src') || '');
                }
                var price = priceFrom(card || a);
                items.push({ title: title, productUrl: abs(href), imageUrl: abs(img), price: price });
            });
            return items;
        });
        (results || []).forEach(function (p) {
            products.push({ title: p.title || '', productUrl: p.productUrl || '', imageUrl: p.imageUrl || '', price: p.price || '-', detail: '', from: 'milanuncios' });
        });
        console.log('Milanuncios extracted ' + (results ? results.length : 0) + ' product(s).');
    } catch (err) {
        console.error('Milanuncios Puppeteer error:', err && (err.message || err));
    } finally {
        if (browser) { try { await browser.close(); } catch (e) {} }
    }
}
async function saveAllProductsToMongo() {
  return saveProductsToMongo(products).then(function () {
    console.log('MongoDB upsert complete.');
  }).catch(function (e) {
    console.error('Mongo upsert error:', e);
  });
}
function saveProductsToFile(list, filePath) {
  try {
    var items = Array.isArray(list) ? list : [];
    var ts = new Date();
    function pad(n) { return (n < 10 ? ('0' + n) : n); }
    var defaultName = 'products_' + ts.getFullYear() + pad(ts.getMonth() + 1) + pad(ts.getDate()) + '_' + pad(ts.getHours()) + pad(ts.getMinutes()) + pad(ts.getSeconds()) + '.json';
    var path = filePath || defaultName;
    var minimal = items.map(function (p) {
      return {
        title: (p.title || '').toString(),
        productUrl: (p.productUrl || '').toString(),
        imageUrl: (p.imageUrl || '').toString(),
        price: (p.price || '-').toString(),
        from: (p.from || '').toString()
      };
    });
    fs.writeFileSync(path, JSON.stringify(minimal, null, 2), 'utf8');
    console.log('Saved ' + minimal.length + ' product(s) to file ' + path);
  } catch (e) {
    console.error('Failed to save products file:', e);
  }
}
async function main() {
    try {
        products = [];
        await ebayScrape();
        await lotArtScrape();
        await invaluableScrapePage('https://www.invaluable.com/search?upcoming=false&query=montblanc%2520149%2520fountain%2520pen&keyword=montblanc%2520149%2520fountain%2520pen');
        await salesroomScrapePage('https://www.the-saleroom.com/en-gb/search-results?searchterm=montblanc%20fountain%20pen&sortterm=publishedDate');
        await carousellScrape();
        await dylanStephenScrapePage('https://www.dylanstephenpens.co.uk/?s=%22montblanc%22+and+%22149%22');
        await penLoverBoutiqueScrapePage('https://penloverboutique.com/search?type=product&options%5Bprefix%5D=last&q=%22montblanc%22+and+%22149%22');
        await vintageAndModernPensScrapePage('https://www.vintageandmodernpens.co.uk/?s=montblanc+149');
        await catawikiScrapePage('https://www.catawiki.com/en/s?q=%22montblanc%22+and+%22149%22&filters=966%255B%255D%3D87393%26l2_categories%255B%255D%3D1375');
        await milanunciosScrapePage('https://www.milanuncios.com/anuncios/?s=montblanc%20149&orden=relevance&fromSearch=1&fromSuggester=0&suggestionUsed=0&hitOrigin=home_search&recentSearchShowed=0&recentSearchUsed=0');
        // await saveProductsToFile(products, 'products_all.json');
        await saveAllProductsToMongo();
        console.log('All done.');
    } catch (err) {
        console.error('Pipeline error:', err);
    }
}
// main();

// --- Simple API server (Express) ---
var app = express();
app.use(express.json());
// Basic CORS handling without extra deps
app.use(function (req, res, next) {
  res.header('Access-Control-Allow-Origin', '*');
  res.header('Access-Control-Allow-Methods', 'GET,POST,PUT,DELETE,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }
  next();
});

var sharedMongoClient;
async function getCollectionHandle() {
  if (!sharedMongoClient) {
    sharedMongoClient = new MongoClient(MONGO_URI);
    await sharedMongoClient.connect();
  }
  var db = sharedMongoClient.db(DB_NAME);
  return db.collection(COLLECTION_NAME);
}

// GET /items → list of items { id, name, price, image, url, saved }
app.get('/items', async function (req, res) {
  try {
    var collection = await getCollectionHandle();
    var q = (req.query.q || '').toString().trim();
    var titleFilter = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    var baseAnd = [ { title: /montblanc/i }, { title: /149/i } ];
    if (titleFilter) baseAnd.push({ title: titleFilter });
    var items = await collection.find({ $and: baseAnd }).sort({ createdAt: -1 }).toArray();
    var itemsList = items.map(function (item) {
      return {
        id: String(item._id),
        name: item.title,
        price: item.price,
        image: item.image,
        url: item.link,
        saved: !!item.like,
        viewed: !!item.viewed,
        createdAt: item.createdAt,
      };
    });
    res.json(itemsList);
  } catch (err) {
    console.error('GET /items error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// GET /items/today → items created today
app.get('/items/today', async function (req, res) {
  try {
    var collection = await getCollectionHandle();
    var q = (req.query.q || '').toString().trim();
    var titleFilter = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    var start = new Date();
    start.setHours(0, 0, 0, 0);
    var end = new Date();
    end.setHours(23, 59, 59, 999);
    var query = {
      $and: [
        { title: /montblanc/i },
        { title: /149/i },
        { createdAt: { $gte: start, $lte: end } }
      ]
    };
    if (titleFilter) query.$and.push({ title: titleFilter });
    var items = await collection.find(query).sort({ createdAt: -1 }).toArray();
    var itemsList = items.map(function (item) {
      return {
        id: String(item._id),
        name: item.title,
        price: item.price,
        image: item.image,
        url: item.link,
        saved: !!item.like,
        viewed: !!item.viewed,
        createdAt: item.createdAt,
      };
    });
    res.json(itemsList);
  } catch (err) {
    console.error('GET /items/today error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /items/last3days → items from last 3 days
app.get('/items/last3days', async function (req, res) {
  try {
    var collection = await getCollectionHandle();
    var q = (req.query.q || '').toString().trim();
    var titleFilter = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    var end = new Date();
    end.setHours(23, 59, 59, 999);
    var start = new Date();
    start.setDate(end.getDate() - 3);
    start.setHours(0, 0, 0, 0);
    var query = {
      $and: [
        { title: /montblanc/i },
        { title: /149/i },
        { createdAt: { $gte: start, $lte: end } }
      ]
    };
    if (titleFilter) query.$and.push({ title: titleFilter });
    var items = await collection.find(query).sort({ createdAt: -1 }).toArray();
    var itemsList = items.map(function (item) {
      return {
        id: String(item._id),
        name: item.title,
        price: item.price,
        image: item.image,
        url: item.link,
        saved: !!item.like,
        viewed: !!item.viewed,
        createdAt: item.createdAt,
      };
    });
    res.json(itemsList);
  } catch (err) {
    console.error('GET /items/last3days error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /items/saved → items with like=true
app.get('/items/saved', async function (req, res) {
  try {
    var collection = await getCollectionHandle();
    var q = (req.query.q || '').toString().trim();
    var titleFilter = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    var query = {
      $and: [
        { title: /montblanc/i },
        { title: /149/i },
        { like: true }
      ]
    };
    if (titleFilter) query.$and.push({ title: titleFilter });
    var items = await collection.find(query).sort({ createdAt: -1 }).toArray();
    var itemsList = items.map(function (item) {
      return {
        id: String(item._id),
        name: item.title,
        price: item.price,
        image: item.image,
        url: item.link,
        saved: !!item.like,
        viewed: !!item.viewed,
        createdAt: item.createdAt,
      };
    });
    res.json(itemsList);
  } catch (err) {
    console.error('GET /items/saved error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

// GET /items/stats → counts for today, last3days, saved
app.get('/items/stats', async function (req, res) {
  try {
    var collection = await getCollectionHandle();
    var q = (req.query.q || '').toString().trim();
    var titleFilter = q ? new RegExp(q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i') : null;
    var todayStart = new Date();
    todayStart.setHours(0, 0, 0, 0);
    var todayEnd = new Date();
    todayEnd.setHours(23, 59, 59, 999);

    var last3Start = new Date();
    last3Start.setDate(todayEnd.getDate() - 3);
    last3Start.setHours(0, 0, 0, 0);

    var baseFilter = { $and: [ { title: /montblanc/i }, { title: /149/i } ] };
    if (titleFilter) baseFilter.$and.push({ title: titleFilter });
    function withDateRange(filter, start, end) {
      return { $and: [ baseFilter, { createdAt: { $gte: start, $lte: end } } ] };
    }

    var [todayCount, last3DaysCount, savedCount] = await Promise.all([
      collection.countDocuments(withDateRange(baseFilter, todayStart, todayEnd)),
      collection.countDocuments(withDateRange(baseFilter, last3Start, todayEnd)),
      collection.countDocuments({ $and: [ baseFilter, { like: true } ] })
    ]);

    res.json({ today: todayCount || 0, last3days: last3DaysCount || 0, saved: savedCount || 0 });
  } catch (err) {
    console.error('GET /items/stats error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});


// PUT /items/:itemId?saved=true|false → update saved flag and return updated item
app.put('/items/:itemId', async function (req, res) {
  try {
    var itemId = req.params.itemId;
    var savedParam = req.query.saved;
    var viewedParam = req.query.viewed;
    if (typeof savedParam === 'undefined' && req.body && typeof req.body.saved !== 'undefined') {
      savedParam = req.body.saved;
    }
    if (typeof viewedParam === 'undefined' && req.body && typeof req.body.viewed !== 'undefined') {
      viewedParam = req.body.viewed;
    }
    var hasSaved = (typeof savedParam !== 'undefined');
    var hasViewed = (typeof viewedParam !== 'undefined');
    var saved = (savedParam === true || savedParam === 'true' || savedParam === '1' || savedParam === 1);
    var viewed = (viewedParam === true || viewedParam === 'true' || viewedParam === '1' || viewedParam === 1);

    var setFields = { updatedAt: new Date() };
    if (hasSaved) setFields.like = saved;
    if (hasViewed) setFields.viewed = viewed;

    var collection = await getCollectionHandle();
    var result = await collection.updateOne({ _id: new ObjectId(itemId) }, { $set: setFields });
    if (!result || result.matchedCount === 0) {
      res.status(404).json({ detail: 'Item not found' });
      return;
    }
    var item = await collection.findOne({ _id: new ObjectId(itemId) });
    res.json({
      id: String(item._id),
      name: item.title,
      price: item.price,
      image: item.image,
      url: item.link,
      saved: !!item.like,
      viewed: !!item.viewed
    });
  } catch (err) {
    console.error('PUT /items/:itemId error:', err);
    res.status(500).json({ error: 'Internal Server Error' });
  }
});

function startServer() {
  var PORT = process.env.PORT || 8000;
  var HOST = process.env.HOST || '0.0.0.0';
  app.listen(PORT, HOST, function () {
    console.log('API server listening on http://' + HOST + ':' + PORT);
  });
}

// Run initial scrape pipeline before starting the server
(function bootstrap() {
  console.log('Bootstrap: starting initial scrape...');
  Promise.resolve()
    .then(function () { return main(); })
    .then(function () {
      console.log('Bootstrap: initial scrape completed.');
    })
    .catch(function (e) {
      console.error('Bootstrap: initial scrape failed:', e);
    })
    .finally(function () {
      startServer();
    });
})();

app.get('/', (req, res) => {
  res.send('Hello World');
});
// startServer();
// --- Schedule daily scrape at 00:00 (system local time) ---
var isScheduledRunInProgress = false;
// Run scrape every 6 hours at minute 0
cron.schedule('0 */6 * * *', async function () {
  if (isScheduledRunInProgress) {
    console.log('Cron: previous run still in progress; skipping this cycle.');
    return;
  }
  isScheduledRunInProgress = true;
  console.log('Cron: starting scheduled scrape at', new Date().toString());
  try {
    await main();
  } catch (e) {
    console.error('Cron: main() failed:', e);
  } finally {
    isScheduledRunInProgress = false;
    console.log('Cron: scheduled scrape finished at', new Date().toString());
  }
}, { scheduled: true });

