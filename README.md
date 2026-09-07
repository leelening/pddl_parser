# PDDL Parser

[![tests](https://github.com/leelening/pddl_parser/actions/workflows/tests.yml/badge.svg?branch=master)](https://github.com/leelening/pddl_parser/actions/workflows/tests.yml)
[![Python](https://img.shields.io/badge/Python-3776AB?style=flat&logo=python&logoColor=white)](https://www.python.org/)
[![Planning](https://img.shields.io/badge/Planning-AI-blue)](http://www.planning.domains/)
[![PDDL](https://img.shields.io/badge/PDDL-Planning-orange)](https://en.wikipedia.org/wiki/Planning_Domain_Definition_Language)

A Python tool to create deterministic transition systems from PDDL (Planning Domain Definition Language) files.

**[Try it in your browser](https://leelening.github.io/pddl_parser/#demo)** — the
project site runs a JavaScript port of this parser client-side, so you can paste a
domain and problem and see the transition graph without installing anything.

## Overview

This parser converts classical planning problems described in PDDL format into deterministic transition systems represented as state transition graphs. It's particularly useful for:

- Converting PDDL planning problems to MDP representations
- Analyzing planning domain structures
- Generating transition systems for reinforcement learning
- Security and attack graph analysis (when combined with MulVAL)

## Features

- 🔄 **PDDL Parsing**: Parse domain and problem PDDL files
- 🗂️ **Transition System**: Generate deterministic transition systems
- 💾 **Pickle Export**: Save transition systems for later use
- 🔗 **MulVAL Integration**: Works with MulVAL attack graphs

## Tech Stack

- **Language**: Python 3.x (developed on Python 3.5+)
- **Dependencies**: none beyond the standard library (`pickle`, `re`, `itertools`)

## Installation

```bash
# Clone the repository
git clone https://github.com/leelening/pddl_parser.git
cd pddl_parser
```

No third-party packages are required. To run the test suite:

```bash
pip install pytest
pytest
```

## Usage

### Basic Usage

```bash
# Generate transition system from PDDL files
python constructor.py ./examples/domain.pddl ./examples/problem.pddl
```

This creates a `transitions.pickle` file containing the deterministic transition system.

### Input Files

The tool expects two PDDL files:

1. **domain.pddl**: Defines the planning domain (predicates, actions, effects)
2. **problem.pddl**: Defines the specific problem instance (initial state, goal)

### Example

An example is provided in the `examples/` directory:

```
examples/
├── domain.pddl     # Example planning domain
└── problem.pddl    # Example problem instance
```

These files can be generated using [mulval_to_pddl](https://github.com/leelening/mulval_to_pddl).

## Project Structure

```
.
├── PDDL.py                  # Tokenizer and domain/problem parser
├── action.py                # One action; grounding over typed objects
├── constructor.py           # Main script to generate transition systems
├── examples/                # Example PDDL files
│   ├── domain.pddl
│   └── problem.pddl
├── tests/test_parser.py     # Regression tests (pytest)
├── docs/                    # GitHub Pages site and its browser port
└── transitions.pickle       # Generated output (after running)
```

## How It Works

### PDDL to Transition System

1. **Parse Domain**: Extract actions, preconditions, and effects
2. **Parse Problem**: Extract initial state and goal conditions
3. **Build State Space**: Breadth-first exploration of the states reachable from the initial state
4. **Generate Transitions**: For each state-action pair, determine next state
5. **Export**: Save as pickle file for later use

### Transition System Format

The output `transitions.pickle` contains a dictionary mapping:
- `transitions[state]` → dict of available action labels
- `transitions[state][action_label]` → next state

Pickled as `[transitions, initial_state]`.

## Integration with MulVAL

This parser is designed to work with [mulval_to_pddl](https://github.com/leelening/mulval_to_pddl):

1. Use MulVAL to generate attack graphs
2. Convert to PDDL using [mulval_to_pddl](https://github.com/leelening/mulval_to_pddl)
3. Parse PDDL to transition system using this tool
4. Use transition system for security analysis or planning

## Fixed Bugs

The bundled example used to report 19 states and 18 transitions. The reachable
state space has 9 states and 33 transitions. Six defects accounted for the
difference, each now pinned by a `test_bug_*` test in `tests/test_parser.py`:

- **States were keyed by insertion order.** A state is a set of facts, but it was
  stored as a list and keyed by that list's order, so one state was explored and
  recorded under several keys. `convert()` now sorts the facts.
- **Transitions into already-visited states were dropped.** The edge was only
  recorded in the branch that discovered a *new* state, which yields a spanning
  tree rather than the transition system: every edge back into a known state,
  including every self-loop, vanished, and goal states came out with no outgoing
  edges at all.
- **Groundings of one action overwrote each other.** Edges were keyed by
  `act.name`, which every grounding of a lifted action shares. They are now keyed
  by `label(act)`, which includes the arguments.
- **A goal true in the initial state raised `ValueError`** — `construct()`
  returned a bare `[]` while every caller unpacks two values — and the early
  return also abandoned the rest of the reachable state space. The goal is not a
  search cutoff.
- **Fact arguments were discarded.** Each fact was reduced to its predicate name,
  collapsing `(at ana p1)` and `(at ana p2)` into one fact. Harmless for a MulVAL
  attack graph, where every predicate takes the same single object, but wrong for
  any other domain.
- **A repeated `:init` fact created a phantom state.** `convert()` sorted the
  facts but never deduplicated them, while `apply()` never emits a repeated fact,
  so the initial state sat under a key no action could produce again.

Smaller fixes: `Action` defined `__eq__` without `__hash__`, which makes a class
unhashable on Python 3; `replace()` substituted parameters one at a time,
re-scanning tokens it had already substituted; `groundify()` raised a bare
`KeyError` for a parameter type the problem declares no objects for; a repeated
`:objects` type kept only the last group; `parse_problem()` failed with an
`AttributeError` when called before `parse_domain()`; `scan_tokens()` shadowed the
`str` and `list` builtins; and this README advertised a `pandas` dependency the
code never imported.

## Development

```bash
pytest -q                     # the Python test suite
node docs/assets/verify.js    # the browser port must match the Python output
```

Both run in CI on every push (`.github/workflows/tests.yml`). The site is
deployed from `docs/` by `.github/workflows/pages.yml`; enable it under
**Settings → Pages → Source: GitHub Actions**.

## Online PDDL Editor

For testing and solving PDDL problems, use the online editor:
- [PDDL Editor](http://editor.planning.domains/)

## API Usage

```python
import pickle

# Load the transition system
with open('transitions.pickle', 'rb') as f:
    transitions, initial_state = pickle.load(f)

# A state is a canonical (sorted) tuple of ground predicates, each itself a
# tuple, e.g. (('attackerlocated', 'internet'), ('execcode', 'h1', 'someuser'))
# An action label is 'name' for a 0-ary action, otherwise 'name(arg1,arg2)'.
#
#   transitions[state][action_label] -> next_state

for action_label, next_state in transitions[initial_state].items():
    print(action_label, '->', next_state)
```

## Dependencies

- Python 3.x (standard library only)

## Limitations

- Supports `:strips`, `:typing` and `:negative-preconditions` only — no numeric
  fluents, conditional effects, durative actions, disjunctive preconditions,
  quantifiers or derived predicates
- Type hierarchies are not resolved: a parameter of type `t` is grounded over the
  objects declared exactly as `t`
- Supports deterministic planning domains only
- State space must be finite and reasonably sized, since it is enumerated
  exhaustively

## License

MIT License - see [LICENSE.md](LICENSE.md) for details

## Acknowledgments

- [pddl-parser](https://github.com/pucrs-automated-planning/pddl-parser) - Reference implementation
- [MulVAL](http://people.cs.ksu.edu/~xou/mulval/) - For attack graph generation
- [PDDL](https://en.wikipedia.org/wiki/Planning_Domain_Definition_Language) - Planning Domain Definition Language

## Author

**Lening Li**
- GitHub: [@leelening](https://github.com/leelening)
