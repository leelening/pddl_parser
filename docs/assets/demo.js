/* Wires the in-browser demo: run the ported parser, draw the graph. */
(function () {
  'use strict';

  var EXPLORE_LIMIT = 6000;   // states explored before giving up
  var DRAW_LIMIT = 90;        // states drawn in the SVG

  var el = {
    picker: document.getElementById('example'),
    note: document.getElementById('example-note'),
    domain: document.getElementById('domain'),
    problem: document.getElementById('problem'),
    build: document.getElementById('build'),
    error: document.getElementById('error'),
    warn: document.getElementById('warn'),
    stats: document.getElementById('stats'),
    graphWrap: document.getElementById('graph-wrap'),
    graph: document.getElementById('graph'),
    detail: document.getElementById('detail')
  };

  var examples = window.PDDL_EXAMPLES || {};
  var result = null;
  var selected = null;

  // -------------------------------------------------------------- helpers

  function text(node, value) { node.textContent = value; }

  function show(node, kind, message) {
    node.className = 'notice ' + kind;
    node.textContent = message;
    node.hidden = false;
  }

  function hide(node) { node.hidden = true; }

  function atomsOf(key) { return result.states[key]; }

  function pretty(atom) {
    return atom.length > 1 ? atom[0] + '(' + atom.slice(1).join(',') + ')' : atom[0];
  }

  function shorten(label, max) {
    return label.length > max ? label.slice(0, max - 1) + '…' : label;
  }

  /* Label a state by how it differs from the initial state: planning states
   * share a large common core, so the delta is what actually distinguishes
   * them on screen. */
  function deltaLabel(key) {
    if (key === result.initial) return ['initial state'];
    var base = {};
    atomsOf(result.initial).forEach(function (a) { base[PDDL.atomKey(a)] = true; });
    var now = {};
    atomsOf(key).forEach(function (a) { now[PDDL.atomKey(a)] = true; });
    var added = atomsOf(key).filter(function (a) { return !base[PDDL.atomKey(a)]; }).map(pretty);
    var removed = atomsOf(result.initial).filter(function (a) { return !now[PDDL.atomKey(a)]; })
      .map(function (a) { return '−' + pretty(a); });
    var lines = added.concat(removed);
    return lines.length ? lines : ['(unchanged)'];
  }

  // ---------------------------------------------------------------- layout

  /* Layer states by BFS distance from the initial state, then place each
   * layer in a column. A column layout keeps long atom labels readable and
   * scrolls naturally on narrow screens. */
  function layout(keys) {
    var depth = {};
    depth[result.initial] = 0;
    var queue = [result.initial];
    while (queue.length) {
      var key = queue.shift();
      var edges = result.transitions[key] || {};
      Object.keys(edges).forEach(function (actionLabel) {
        var next = edges[actionLabel];
        if (!(next in depth) && keys.indexOf(next) !== -1) {
          depth[next] = depth[key] + 1;
          queue.push(next);
        }
      });
    }
    var layers = [];
    keys.forEach(function (key) {
      var d = key in depth ? depth[key] : 0;
      (layers[d] = layers[d] || []).push(key);
    });

    var nodeW = 250, nodeH, gapX = 92, gapY = 22, padding = 26;
    var positions = {};
    var maxBottom = 0;
    layers.forEach(function (layer, i) {
      var y = padding;
      layer.forEach(function (key) {
        var lines = deltaLabel(key);
        nodeH = 26 + Math.min(lines.length, 5) * 14;
        positions[key] = { x: padding + i * (nodeW + gapX), y: y, w: nodeW, h: nodeH, lines: lines };
        y += nodeH + gapY;
      });
      maxBottom = Math.max(maxBottom, y);
    });
    return {
      positions: positions,
      width: padding * 2 + layers.length * nodeW + Math.max(0, layers.length - 1) * gapX,
      height: maxBottom + padding,
      depth: depth
    };
  }

  function svgEl(name, attrs) {
    var node = document.createElementNS('http://www.w3.org/2000/svg', name);
    Object.keys(attrs || {}).forEach(function (k) { node.setAttribute(k, attrs[k]); });
    return node;
  }

  function draw() {
    var keys = Object.keys(result.states);
    var drawn = keys.slice(0, DRAW_LIMIT);
    var geom = layout(drawn);
    var svg = el.graph;
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    svg.setAttribute('viewBox', '0 0 ' + geom.width + ' ' + geom.height);
    svg.setAttribute('width', geom.width);
    svg.setAttribute('height', geom.height);

    var defs = svgEl('defs');
    var marker = svgEl('marker', {
      id: 'arrow', viewBox: '0 0 8 8', refX: '7', refY: '4',
      markerWidth: '6', markerHeight: '6', orient: 'auto-start-reverse'
    });
    marker.appendChild(svgEl('path', { d: 'M 0 1 L 7 4 L 0 7 z', fill: 'currentColor' }));
    defs.appendChild(marker);
    svg.appendChild(defs);

    var edgeLayer = svgEl('g', { class: 'edges', color: 'var(--border-strong)' });
    var nodeLayer = svgEl('g', { class: 'nodes' });
    svg.appendChild(edgeLayer);
    svg.appendChild(nodeLayer);

    var goals = {};
    result.goalStates.forEach(function (k) { goals[k] = true; });

    drawn.forEach(function (key) {
      var from = geom.positions[key];
      var edges = result.transitions[key] || {};
      Object.keys(edges).forEach(function (actionLabel) {
        var to = geom.positions[edges[actionLabel]];
        if (!to) return;
        var path;
        if (edges[actionLabel] === key) {
          // Self-loop: a small arc off the right edge of the node.
          var cx = from.x + from.w, cy = from.y + from.h / 2;
          path = 'M ' + cx + ' ' + (cy - 7) + ' C ' + (cx + 34) + ' ' + (cy - 26) + ', ' +
            (cx + 34) + ' ' + (cy + 26) + ', ' + cx + ' ' + (cy + 7);
        } else {
          var x1 = from.x + from.w, y1 = from.y + from.h / 2;
          var x2 = to.x, y2 = to.y + to.h / 2;
          if (x2 < x1) { x1 = from.x + from.w / 2; y1 = from.y + from.h; x2 = to.x + to.w / 2; y2 = to.y; }
          var mx = (x1 + x2) / 2;
          path = 'M ' + x1 + ' ' + y1 + ' C ' + mx + ' ' + y1 + ', ' + mx + ' ' + y2 + ', ' + x2 + ' ' + y2;
        }
        var line = svgEl('path', { class: 'edge', d: path, 'marker-end': 'url(#arrow)' });
        line.dataset.from = key;
        line.appendChild(svgEl('title')).textContent = actionLabel;
        edgeLayer.appendChild(line);
      });
    });

    drawn.forEach(function (key) {
      var pos = geom.positions[key];
      var classes = ['node'];
      if (key === result.initial) classes.push('initial');
      if (goals[key]) classes.push('goal');
      var group = svgEl('g', { class: classes.join(' '), tabindex: '0', role: 'button' });
      group.dataset.key = key;
      group.appendChild(svgEl('rect', { x: pos.x, y: pos.y, width: pos.w, height: pos.h, rx: 6 }));
      var head = svgEl('text', { x: pos.x + 11, y: pos.y + 17 });
      head.textContent = shorten(pos.lines[0], 34);
      group.appendChild(head);
      pos.lines.slice(1, 5).forEach(function (line, i) {
        var sub = svgEl('text', { class: 'sub', x: pos.x + 11, y: pos.y + 31 + i * 13 });
        sub.textContent = shorten(line, 38);
        group.appendChild(sub);
      });
      if (pos.lines.length > 5) {
        var more = svgEl('text', { class: 'sub', x: pos.x + 11, y: pos.y + 31 + 4 * 13 });
        more.textContent = '+' + (pos.lines.length - 5) + ' more';
        group.appendChild(more);
      }
      group.appendChild(svgEl('title')).textContent = atomsOf(key).map(pretty).join('\n');
      group.addEventListener('click', function () { select(key); });
      group.addEventListener('keydown', function (event) {
        if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); select(key); }
      });
      nodeLayer.appendChild(group);
    });

    el.graphWrap.hidden = false;
    select(result.initial);

    if (keys.length > drawn.length) {
      show(el.warn, 'warn', 'Showing the first ' + drawn.length + ' of ' + keys.length +
        ' states. The full system is still built in memory — run the Python tool for the complete graph.');
    }
  }

  // -------------------------------------------------------------- details

  function select(key) {
    selected = key;
    Array.prototype.forEach.call(el.graph.querySelectorAll('.node'), function (node) {
      node.classList.toggle('selected', node.dataset.key === key);
    });
    Array.prototype.forEach.call(el.graph.querySelectorAll('.edge'), function (edge) {
      edge.classList.toggle('hot', edge.dataset.from === key);
    });

    var base = {};
    atomsOf(result.initial).forEach(function (a) { base[PDDL.atomKey(a)] = true; });
    var edges = result.transitions[key] || {};
    var isGoal = result.goalStates.indexOf(key) !== -1;

    var html = '<h3>Selected state' +
      (key === result.initial ? ' &middot; initial' : '') +
      (isGoal ? ' &middot; <span style="color:var(--ok)">goal satisfied</span>' : '') + '</h3>';
    html += '<ul class="atoms">' + atomsOf(key).map(function (atom) {
      var added = !base[PDDL.atomKey(atom)];
      return '<li class="' + (added ? 'added' : '') + '">' + escapeHtml(pretty(atom)) + '</li>';
    }).join('') + '</ul>';

    var labels = Object.keys(edges).sort();
    if (!labels.length) {
      html += '<p style="color:var(--text-dim);font-size:14px">No applicable action in this state.</p>';
    } else {
      html += '<div class="scroll-x"><table><thead><tr><th>Applicable action</th><th>Successor</th></tr></thead><tbody>';
      labels.forEach(function (actionLabel) {
        var next = edges[actionLabel];
        var label = next === key ? 'self-loop' : deltaLabel(next).join(', ');
        html += '<tr><td><code>' + escapeHtml(actionLabel) + '</code></td><td>' +
          '<button class="btn" data-goto="' + escapeHtml(next) + '" style="padding:3px 9px;font-size:12.5px">' +
          escapeHtml(shorten(label, 60)) + '</button></td></tr>';
      });
      html += '</tbody></table></div>';
    }
    el.detail.innerHTML = html;
    Array.prototype.forEach.call(el.detail.querySelectorAll('[data-goto]'), function (button) {
      button.addEventListener('click', function () { select(button.dataset.goto); });
    });
  }

  function escapeHtml(value) {
    return String(value).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ----------------------------------------------------------------- build

  function build() {
    hide(el.error);
    hide(el.warn);
    var started = performance.now();
    try {
      result = PDDL.construct(el.domain.value, el.problem.value, EXPLORE_LIMIT);
    } catch (error) {
      result = null;
      el.stats.hidden = true;
      el.graphWrap.hidden = true;
      el.detail.innerHTML = '';
      show(el.error, 'err', error.message || String(error));
      return;
    }
    var elapsed = performance.now() - started;
    var stateCount = Object.keys(result.states).length;

    el.stats.hidden = false;
    el.stats.innerHTML = [
      ['States', stateCount],
      ['Transitions', result.edgeCount],
      ['Ground actions', groundCount(result.parser)],
      ['Goal states', result.goalStates.length],
      ['Build time', elapsed.toFixed(1) + ' ms']
    ].map(function (pair) {
      return '<div class="stat"><div class="v">' + pair[1] + '</div><div class="k">' + pair[0] + '</div></div>';
    }).join('');

    draw();

    var messages = result.warnings.slice();
    if (result.truncated) {
      messages.unshift('Exploration stopped at ' + EXPLORE_LIMIT +
        ' states; the graph shown is a prefix of the reachable state space.');
    }
    if (!result.goalStates.length) {
      messages.unshift('The goal is not reachable from the initial state.');
    }
    if (messages.length) show(el.warn, 'warn', messages.join(' '));
  }

  function groundCount(parser) {
    var total = 0;
    parser.actions.forEach(function (action) {
      try { total += action.groundify(parser.objects).length; } catch (e) { /* reported elsewhere */ }
    });
    return total;
  }

  // ------------------------------------------------------------------ init

  Object.keys(examples).forEach(function (name) {
    var option = document.createElement('option');
    option.value = name;
    option.textContent = examples[name].label;
    el.picker.appendChild(option);
  });

  function load(name) {
    var example = examples[name];
    if (!example) return;
    el.domain.value = example.domain;
    el.problem.value = example.problem;
    text(el.note, example.note);
    build();
  }

  el.picker.addEventListener('change', function () { load(el.picker.value); });
  el.build.addEventListener('click', build);
  el.picker.value = 'attack';
  load('attack');
}());
