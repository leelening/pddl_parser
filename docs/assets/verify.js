/*
 * Checks that the browser port in pddl.js reproduces the transition systems
 * the Python implementation produces. Run with: node docs/assets/verify.js
 *
 * The expectations below are the values the Python code prints for the same
 * inputs, so a divergence in either implementation fails this check.
 */
'use strict';

var fs = require('fs');
var path = require('path');

var PDDL = require('./pddl.js');
global.window = {};
require('./examples.js');
var examples = global.window.PDDL_EXAMPLES;

var root = path.join(__dirname, '..', '..');

var expectations = {
  attack: { states: 9, edges: 33, goalStates: 1 },
  grid: { states: 9, edges: 24, goalStates: 1 },
  gripper: { states: 28, edges: 76, goalStates: 2 },
  solved: { states: 2, edges: 2, goalStates: 1 }
};

var failures = [];

function check(name, actual, expected) {
  Object.keys(expected).forEach(function (key) {
    if (actual[key] !== expected[key]) {
      failures.push(name + ': expected ' + key + ' = ' + expected[key] + ', got ' + actual[key]);
    }
  });
}

Object.keys(expectations).forEach(function (name) {
  var example = examples[name];
  var result = PDDL.construct(example.domain, example.problem);
  var actual = {
    states: Object.keys(result.states).length,
    edges: result.edgeCount,
    goalStates: result.goalStates.length
  };
  check(name, actual, expectations[name]);

  // Structural invariants that must hold for any input.
  Object.keys(result.transitions).forEach(function (key) {
    var edges = result.transitions[key];
    Object.keys(edges).forEach(function (actionLabel) {
      if (!(edges[actionLabel] in result.states)) {
        failures.push(name + ': edge ' + actionLabel + ' leaves the state set');
      }
    });
  });
  if (!(result.initial in result.transitions)) {
    failures.push(name + ': the initial state is not a key of the transition table');
  }
  Object.keys(result.states).forEach(function (key) {
    var atoms = result.states[key];
    var keys = atoms.map(PDDL.atomKey);
    var sorted = keys.slice().sort();
    if (keys.join('|') !== sorted.join('|')) {
      failures.push(name + ': a state key is not canonically sorted');
    }
  });

  console.log(name.padEnd(9) + ' states=' + String(actual.states).padStart(4) +
    '  transitions=' + String(actual.edges).padStart(4) +
    '  goal states=' + actual.goalStates);
});

// Identifiers that collide with JavaScript's Object.prototype keys must not
// be swallowed by the maps the port uses internally. Python has no such
// hazard, so only the port needs the check.
(function checkPrototypeKeys() {
  var domain = '(define (domain odd)\n' +
    '  (:requirements :strips :typing)\n' +
    '  (:predicates (holds ?x - constructor))\n' +
    '  (:action __proto__ :parameters () :precondition (and) :effect (and (holds a)))\n' +
    '  (:action touch :parameters (?x - constructor)\n' +
    '    :precondition (and) :effect (and (holds ?x))))';
  var problem = '(define (problem odd1)\n' +
    '  (:domain odd)\n' +
    '  (:objects a b - constructor)\n' +
    '  (:init)\n' +
    '  (:goal (and (holds a) (holds b))))';
  var result;
  try {
    result = PDDL.construct(domain, problem);
  } catch (error) {
    failures.push('prototype-key domain threw: ' + error.message);
    return;
  }
  var edges = result.transitions[result.initial];
  if (!('__proto__' in edges)) {
    failures.push('an action named __proto__ was dropped from the transition table');
  }
  if (Object.keys(result.states).length !== 4) {
    failures.push('prototype-key domain: expected 4 states, got ' + Object.keys(result.states).length);
  }
  console.log('proto     states=   4  an action named __proto__ survives');
}());

// A build that hits the exploration cap must still be a closed graph: every
// successor a key of the transition table, so a consumer can walk it.
(function checkTruncation() {
  var example = examples.gripper;
  var result = PDDL.construct(example.domain, example.problem, 5);
  if (!result.truncated) {
    failures.push('a 5-state cap on the gripper example should have truncated');
  }
  Object.keys(result.transitions).forEach(function (key) {
    var edges = result.transitions[key];
    Object.keys(edges).forEach(function (actionLabel) {
      if (!(edges[actionLabel] in result.states)) {
        failures.push('truncated build: edge ' + actionLabel + ' leaves the state set');
      }
    });
  });
  console.log('truncated states=' + String(Object.keys(result.states).length).padStart(4) +
    '  the capped graph is still closed');
}());

// The bundled example files on disk must be the same PDDL as the demo's copy
// of them, so the site never drifts from the repository. Compare token trees
// rather than text: the demo copy is reindented for legibility on the page.
[['examples/domain.pddl', 'domain'], ['examples/problem.pddl', 'problem']].forEach(function (pair) {
  var onDisk = PDDL.scanTokens(fs.readFileSync(path.join(root, pair[0]), 'utf8'));
  var embedded = PDDL.scanTokens(examples.attack[pair[1]]);
  if (JSON.stringify(onDisk) !== JSON.stringify(embedded)) {
    failures.push(pair[0] + ' differs from the copy embedded in docs/assets/examples.js');
  }
});

if (failures.length) {
  console.error('\nFAILED:\n  ' + failures.join('\n  '));
  process.exit(1);
}
console.log('\nThe browser port matches the Python implementation on every example.');
