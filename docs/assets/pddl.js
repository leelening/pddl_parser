/*
 * pddl.js -- a faithful JavaScript port of the Python parser in this
 * repository (PDDL.py / action.py / constructor.py). It powers the
 * in-browser demo on the project site; the Python code stays the
 * reference implementation.
 *
 * The port is deliberately structured like the Python: scanTokens ->
 * parseDomain / parseProblem -> groundify -> construct.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.PDDL = factory();
}(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var SUPPORTED_REQUIREMENTS = [':strips', ':negative-preconditions', ':typing'];

  // ------------------------------------------------------------ tokenizer

  function scanTokens(text) {
    // Strip single-line comments and fold case: PDDL is case-insensitive.
    var cleaned = text.replace(/;[^\n]*/g, '').toLowerCase();
    var stack = [];
    var current = [];
    var tokens = cleaned.match(/[()]|[^\s()]+/g) || [];
    for (var i = 0; i < tokens.length; i++) {
      var token = tokens[i];
      if (token === '(') {
        stack.push(current);
        current = [];
      } else if (token === ')') {
        if (!stack.length) throw new Error('Missing open parentheses');
        var nested = current;
        current = stack.pop();
        current.push(nested);
      } else {
        current.push(token);
      }
    }
    if (stack.length) throw new Error('Missing close parentheses');
    if (current.length !== 1) throw new Error('Malformed expression');
    return current[0];
  }

  // --------------------------------------------------------------- action

  function Action(name, parameters, positivePreconditions, negativePreconditions, addEffects, delEffects) {
    this.name = name;
    // Lifted actions carry [variable, type] pairs; a grounded action carries
    // the flat list of objects it was grounded with. Keep both shapes.
    this.parameters = parameters.slice();
    this.positivePreconditions = freeze(positivePreconditions);
    this.negativePreconditions = freeze(negativePreconditions);
    this.addEffects = freeze(addEffects);
    this.delEffects = freeze(delEffects);
  }

  function freeze(predicates) {
    return predicates.map(function (p) { return p.slice(); });
  }

  /* A unique label for a grounded action. Two groundings of one lifted
   * action share .name, so the name alone cannot key a transition. This
   * mirrors label() in constructor.py. */
  Action.prototype.label = function () {
    var args = this.parameters.filter(function (p) { return typeof p === 'string'; });
    return args.length ? this.name + '(' + args.join(',') + ')' : this.name;
  };

  Action.prototype.groundify = function (objects) {
    var self = this;
    if (!this.parameters.length) return [this];
    var variables = [];
    var domains = [];
    for (var i = 0; i < this.parameters.length; i++) {
      var pair = this.parameters[i];
      var variable = pair[0];
      var varType = pair[1];
      if (!(varType in objects) || !objects[varType]) {
        throw new Error('Action ' + this.name + ' declares parameter ' + variable +
          ' of type ' + varType + ', but the problem file defines no objects of that type');
      }
      variables.push(variable);
      domains.push(objects[varType]);
    }
    return product(domains).map(function (assignment) {
      return new Action(
        self.name,
        assignment,
        replace(self.positivePreconditions, variables, assignment),
        replace(self.negativePreconditions, variables, assignment),
        replace(self.addEffects, variables, assignment),
        replace(self.delEffects, variables, assignment)
      );
    });
  };

  function product(domains) {
    return domains.reduce(function (acc, domain) {
      var out = [];
      acc.forEach(function (prefix) {
        domain.forEach(function (value) { out.push(prefix.concat([value])); });
      });
      return out;
    }, [[]]);
  }

  function replace(group, variables, assignment) {
    var substitution = {};
    variables.forEach(function (variable, i) { substitution[variable] = assignment[i]; });
    return group.map(function (predicate) {
      return predicate.map(function (token) {
        return Object.prototype.hasOwnProperty.call(substitution, token) ? substitution[token] : token;
      });
    });
  }

  // --------------------------------------------------------------- parser

  function Parser() {
    this.domainName = null;
    this.problemName = null;
    this.requirements = [];
    this.types = [];
    this.actions = [];
    // Null-prototype maps: a PDDL identifier may legitimately be named
    // "constructor" or "__proto__", which on a plain object would collide
    // with an inherited property and silently corrupt or drop the entry.
    this.predicates = Object.create(null);
    this.objects = Object.create(null);
    this.state = [];
    this.positiveGoals = [];
    this.negativeGoals = [];
    this.warnings = [];
  }

  Parser.prototype.parseDomain = function (text) {
    var tokens = scanTokens(text);
    if (!Array.isArray(tokens) || tokens.shift() !== 'define') {
      throw new Error('The domain text does not match the domain pattern');
    }
    this.domainName = 'unknown';
    this.requirements = [];
    this.types = [];
    this.actions = [];
    this.predicates = Object.create(null);
    while (tokens.length) {
      var group = tokens.shift();
      if (!group || !group.length) continue;
      var t = group.shift();
      if (t === 'domain') {
        this.domainName = group[0];
      } else if (t === ':requirements') {
        for (var i = 0; i < group.length; i++) {
          if (SUPPORTED_REQUIREMENTS.indexOf(group[i]) === -1) {
            throw new Error('Requirement ' + group[i] + ' not supported');
          }
        }
        this.requirements = group;
      } else if (t === ':predicates') {
        this.parsePredicates(group);
      } else if (t === ':types') {
        this.types = group;
      } else if (t === ':action') {
        this.parseAction(group);
      } else {
        this.warnings.push(t + ' is not recognized in domain');
      }
    }
  };

  Parser.prototype.parsePredicates = function (group) {
    for (var i = 0; i < group.length; i++) {
      var pred = group[i].slice();
      var name = pred.shift();
      if (name in this.predicates) {
        throw new Error('Predicate ' + name + ' redefined');
      }
      var args = {};
      var untyped = [];
      while (pred.length) {
        var t = pred.shift();
        if (t === '-') {
          if (!untyped.length) throw new Error('Unexpected hyphen in predicates');
          var argType = pred.shift();
          while (untyped.length) args[untyped.shift()] = argType;
        } else {
          untyped.push(t);
        }
      }
      while (untyped.length) args[untyped.shift()] = 'object';
      this.predicates[name] = args;
    }
  };

  Parser.prototype.parseAction = function (group) {
    var name = group.shift();
    if (typeof name !== 'string') throw new Error('Action without name definition');
    for (var i = 0; i < this.actions.length; i++) {
      if (this.actions[i].name === name) throw new Error('Action ' + name + ' redefined');
    }
    var parameters = [];
    var positive = [];
    var negative = [];
    var add = [];
    var del = [];
    while (group.length) {
      var t = group.shift();
      if (t === ':parameters') {
        parameters = [];
        var untyped = [];
        var p = (group.shift() || []).slice();
        while (p.length) {
          var token = p.shift();
          if (token === '-') {
            if (!untyped.length) throw new Error('Unexpected hyphen in ' + name + ' parameters');
            var ptype = p.shift();
            while (untyped.length) parameters.push([untyped.shift(), ptype]);
          } else {
            untyped.push(token);
          }
        }
        while (untyped.length) parameters.push([untyped.shift(), 'object']);
      } else if (t === ':precondition') {
        this.splitPredicates(group.shift(), positive, negative, name, ' preconditions');
      } else if (t === ':effect') {
        this.splitPredicates(group.shift(), add, del, name, ' effects');
      } else {
        this.warnings.push(t + ' is not recognized in action');
      }
    }
    this.actions.push(new Action(name, parameters, positive, negative, add, del));
  };

  Parser.prototype.parseProblem = function (text) {
    if (this.domainName === null) throw new Error('parseDomain must be called before parseProblem');
    var tokens = scanTokens(text);
    if (!Array.isArray(tokens) || tokens.shift() !== 'define') {
      throw new Error('The problem text does not match the problem pattern');
    }
    this.problemName = 'unknown';
    this.objects = Object.create(null);
    this.state = [];
    this.positiveGoals = [];
    this.negativeGoals = [];
    while (tokens.length) {
      var group = (tokens.shift() || []).slice();
      if (!group.length) continue;
      var t = group[0];
      if (t === 'problem') {
        this.problemName = group[group.length - 1];
      } else if (t === ':domain') {
        if (this.domainName !== group[group.length - 1]) {
          throw new Error('Different domain specified in problem file: expected ' +
            this.domainName + ', found ' + group[group.length - 1]);
        }
      } else if (t === ':requirements') {
        // Ignored in the problem; parsed in the domain.
      } else if (t === ':objects') {
        group.shift();
        var pending = [];
        while (group.length) {
          if (group[0] === '-') {
            group.shift();
            var objectType = group.shift();
            // A type may be declared more than once: extend, do not overwrite.
            if (!(objectType in this.objects)) this.objects[objectType] = [];
            this.objects[objectType] = this.objects[objectType].concat(pending);
            pending = [];
          } else {
            pending.push(group.shift());
          }
        }
        if (pending.length) {
          if (!('object' in this.objects)) this.objects.object = [];
          this.objects.object = this.objects.object.concat(pending);
        }
      } else if (t === ':init') {
        group.shift();
        this.state = group;
      } else if (t === ':goal') {
        this.splitPredicates(group[1], this.positiveGoals, this.negativeGoals, '', 'goals');
      } else {
        this.warnings.push(t + ' is not recognized in problem');
      }
    }
    if (!this.positiveGoals.length && !this.negativeGoals.length) {
      this.warnings.push('the problem file declares no goal conditions');
    }
  };

  Parser.prototype.splitPredicates = function (group, pos, neg, name, part) {
    if (!Array.isArray(group)) throw new Error('Error with ' + name + part);
    if (!group.length) return;
    var items = group[0] === 'and' ? group.slice(1) : [group];
    for (var i = 0; i < items.length; i++) {
      var predicate = items[i];
      if (!predicate || !predicate.length) continue;
      if (predicate[0] === 'not') {
        if (predicate.length !== 2) throw new Error('Unexpected not in ' + name + part);
        neg.push(predicate[predicate.length - 1]);
      } else {
        pos.push(predicate);
      }
    }
  };

  // ---------------------------------------------------------- constructor

  function atomKey(atom) { return atom.join(' '); }

  /* Canonical, order-independent key for a state (a set of ground atoms). */
  function convert(atoms) {
    var seen = Object.create(null);
    var out = [];
    atoms.forEach(function (atom) {
      var key = atomKey(atom);
      if (!seen[key]) { seen[key] = true; out.push(atom.slice()); }
    });
    out.sort(function (a, b) { return atomKey(a) < atomKey(b) ? -1 : atomKey(a) > atomKey(b) ? 1 : 0; });
    return out;
  }

  function stateKey(atoms) { return atoms.map(atomKey).join('|'); }

  function applicable(atomSet, positive, negative) {
    for (var i = 0; i < positive.length; i++) {
      if (!atomSet[atomKey(positive[i])]) return false;
    }
    for (var j = 0; j < negative.length; j++) {
      if (atomSet[atomKey(negative[j])]) return false;
    }
    return true;
  }

  function applyEffects(atoms, add, del) {
    var deleted = Object.create(null);
    del.forEach(function (atom) { deleted[atomKey(atom)] = true; });
    var kept = atoms.filter(function (atom) { return !deleted[atomKey(atom)]; });
    return convert(kept.concat(add));
  }

  function toSet(atoms) {
    var set = Object.create(null);
    atoms.forEach(function (atom) { set[atomKey(atom)] = true; });
    return set;
  }

  /* Build the reachable transition system.
   *
   * Returns { states, initial, transitions, edgeCount, goalStates } where
   * `states` maps a canonical state key to its atom list and `transitions`
   * maps a state key to { actionSignature: successorStateKey }.
   *
   * `limit` caps the number of states explored so the browser demo cannot
   * be wedged by a domain whose state space blows up; `truncated` says
   * whether the cap was hit.
   */
  function construct(domainText, problemText, limit) {
    limit = limit || 20000;
    var parser = new Parser();
    parser.parseDomain(domainText);
    parser.parseProblem(problemText);

    var groundActions = [];
    parser.actions.forEach(function (action) {
      action.groundify(parser.objects).forEach(function (act) { groundActions.push(act); });
    });

    var initialAtoms = convert(parser.state);
    var initialKey = stateKey(initialAtoms);
    var states = Object.create(null);
    states[initialKey] = initialAtoms;
    var transitions = Object.create(null);

    var goalHolds = function (atoms) {
      return applicable(toSet(atoms), parser.positiveGoals, parser.negativeGoals);
    };

    // The goal is not a search cutoff: the result describes every reachable
    // state, so a goal state is expanded like any other.
    var queue = [initialKey];
    var truncated = false;
    var stateCount = 1;
    while (queue.length) {
      var key = queue.shift();
      var atoms = states[key];
      var atomSet = toSet(atoms);
      // A parameterless action may be named "__proto__", which on a plain
      // object would be swallowed rather than stored.
      var successors = Object.create(null);
      for (var i = 0; i < groundActions.length; i++) {
        var act = groundActions[i];
        if (!applicable(atomSet, act.positivePreconditions, act.negativePreconditions)) continue;
        var nextAtoms = applyEffects(atoms, act.addEffects, act.delEffects);
        var nextKey = stateKey(nextAtoms);
        if (!(nextKey in states)) {
          // At the exploration cap, drop the edge rather than record one
          // that points outside the state set: callers rely on every
          // successor being a key of `transitions`. The queue is still
          // drained, so the truncated result is a closed prefix of the
          // reachable state space rather than a graph with dangling edges.
          if (stateCount >= limit) { truncated = true; continue; }
          states[nextKey] = nextAtoms;
          stateCount += 1;
          queue.push(nextKey);
        }
        // Record every edge, including those back into a state already seen
        // and self-loops.
        successors[act.label()] = nextKey;
      }
      transitions[key] = successors;
    }
    return summary(parser, states, transitions, initialKey, goalHolds, truncated);
  }

  function summary(parser, states, transitions, initialKey, goalHolds, truncated) {
    // Drop states that were discovered but never expanded (only possible
    // when the exploration limit was hit) so every key has an edge list.
    Object.keys(states).forEach(function (key) {
      if (!(key in transitions)) transitions[key] = Object.create(null);
    });
    var edgeCount = 0;
    Object.keys(transitions).forEach(function (key) {
      edgeCount += Object.keys(transitions[key]).length;
    });
    var goalStates = Object.keys(states).filter(function (key) { return goalHolds(states[key]); });
    return {
      parser: parser,
      states: states,
      transitions: transitions,
      initial: initialKey,
      edgeCount: edgeCount,
      goalStates: goalStates,
      truncated: truncated,
      warnings: parser.warnings.slice()
    };
  }

  return {
    scanTokens: scanTokens,
    Action: Action,
    Parser: Parser,
    construct: construct,
    convert: convert,
    stateKey: stateKey,
    atomKey: atomKey
  };
}));
