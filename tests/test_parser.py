"""Regression tests for the PDDL parser and transition-system constructor.

Each test named ``test_bug_*`` pins down a defect that used to be present.
"""

import os
import pickle
import shutil
import subprocess
import sys

import pytest

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
sys.path.insert(0, ROOT)

from PDDL import PDDL_Parser  # noqa: E402
from action import Action  # noqa: E402
from constructor import Constructor, convert, label  # noqa: E402

EXAMPLES = os.path.join(ROOT, 'examples')
DOMAIN = os.path.join(EXAMPLES, 'domain.pddl')
PROBLEM = os.path.join(EXAMPLES, 'problem.pddl')

GRID_DOMAIN = """
(define (domain grid)
  (:requirements :strips :typing :negative-preconditions)
  (:predicates (at ?ag - agent ?p - pos) (adjacent ?a - pos ?b - pos))
  (:action move
    :parameters (?ag - agent ?from - pos ?to - pos)
    :precondition (and (at ?ag ?from) (adjacent ?from ?to) (not (at ?ag ?to)))
    :effect (and (at ?ag ?to) (not (at ?ag ?from))))
)
"""

GRID_PROBLEM = """
(define (problem grid1)
  (:domain grid)
  (:objects ana - agent p1 p2 - pos)
  (:init (at ana p1) (adjacent p1 p2) (adjacent p2 p1))
  (:goal (and (at ana p2)))
)
"""


# ---------------------------------------------------------------- fixtures

@pytest.fixture
def example_parser():
    parser = PDDL_Parser()
    parser.parse_domain(DOMAIN)
    parser.parse_problem(PROBLEM)
    return parser


@pytest.fixture
def example_system():
    return Constructor().construct(DOMAIN, PROBLEM)


def write(tmp_path, name, text):
    path = tmp_path / name
    path.write_text(text)
    return str(path)


def grid(tmp_path, problem=GRID_PROBLEM):
    return (write(tmp_path, 'dom.pddl', GRID_DOMAIN),
            write(tmp_path, 'prob.pddl', problem))


# ---------------------------------------------------------------- parsing

def test_domain_and_problem_parse(example_parser):
    assert example_parser.domain_name == 'attack_graph'
    assert example_parser.problem_name == 'pb1'
    assert len(example_parser.actions) == 5
    assert len(example_parser.state) == 8
    assert len(example_parser.positive_goals) == 4
    assert example_parser.negative_goals == []


def test_scan_tokens_rejects_unbalanced_parentheses(tmp_path):
    parser = PDDL_Parser()
    with pytest.raises(Exception, match='Missing close parentheses'):
        parser.scan_tokens(write(tmp_path, 'a.pddl', '(define (domain d)'))
    with pytest.raises(Exception, match='Missing open parentheses'):
        parser.scan_tokens(write(tmp_path, 'b.pddl', '(define))'))


def test_comments_are_stripped(tmp_path):
    parser = PDDL_Parser()
    tokens = parser.scan_tokens(write(tmp_path, 'c.pddl', '(define ; a comment\n (domain d))'))
    assert tokens == ['define', ['domain', 'd']]


def test_unsupported_requirement_is_rejected(tmp_path):
    parser = PDDL_Parser()
    with pytest.raises(Exception, match='not supported'):
        parser.parse_domain(write(tmp_path, 'd.pddl', '(define (domain d) (:requirements :fluents))'))


def test_typed_parameters_and_predicates(tmp_path):
    parser = PDDL_Parser()
    parser.parse_domain(write(tmp_path, 'dom.pddl', GRID_DOMAIN))
    move = parser.actions[0]
    assert move.parameters == [['?ag', 'agent'], ['?from', 'pos'], ['?to', 'pos']]
    assert move.negative_preconditions == [['at', '?ag', '?to']]
    assert parser.predicates['at'] == {'?ag': 'agent', '?p': 'pos'}


def test_bug_parse_problem_without_domain_raises_clear_error(tmp_path):
    """It used to fail with a bare AttributeError on self.domain_name."""
    parser = PDDL_Parser()
    with pytest.raises(Exception, match='parse_domain must be called'):
        parser.parse_problem(write(tmp_path, 'p.pddl', GRID_PROBLEM))


def test_bug_repeated_object_type_declaration_is_not_overwritten(tmp_path):
    """`:objects p1 - pos p2 - pos` used to keep only the last group."""
    parser = PDDL_Parser()
    parser.parse_domain(write(tmp_path, 'dom.pddl', GRID_DOMAIN))
    parser.parse_problem(write(tmp_path, 'prob.pddl', """
(define (problem grid2)
  (:domain grid)
  (:objects ana - agent p1 - pos p2 - pos)
  (:init (at ana p1) (adjacent p1 p2))
  (:goal (and (at ana p2)))
)
"""))
    assert sorted(parser.objects['pos']) == ['p1', 'p2']


def test_untyped_objects_fall_back_to_the_object_type(example_parser):
    assert example_parser.objects == {'object': ['s']}


# ---------------------------------------------------------------- actions

def test_groundify_enumerates_every_assignment():
    action = Action('move', [['?ag', 'agent'], ['?from', 'pos'], ['?to', 'pos']],
                    [['at', '?ag', '?from']], [], [['at', '?ag', '?to']], [['at', '?ag', '?from']])
    assert len(list(action.groundify({'agent': ['ana', 'bob'], 'pos': ['p1', 'p2']}))) == 8


def test_bug_groundify_reports_a_missing_type():
    """It used to raise a bare KeyError from deep inside groundify."""
    action = Action('move', [['?ag', 'robot']], [], [], [], [])
    with pytest.raises(Exception, match='no objects of that type'):
        list(action.groundify({'agent': ['ana']}))


def test_bug_actions_are_hashable():
    """Defining __eq__ without __hash__ made Action unusable as a dict key."""
    action = Action('a', [], [], [], [], [])
    assert {action: 1}[Action('a', [], [], [], [], [])] == 1


def test_bug_replace_substitutes_every_variable_simultaneously():
    """Substituting one variable at a time re-scans tokens already replaced.

    Here ?a takes the value '?b', so a sequential substitution would then
    replace that value again when it comes to ?b.
    """
    action = Action('swap', [['?a', 't'], ['?b', 't']], [['p', '?a', '?b']], [], [], [])
    grounded = list(action.groundify({'t': ['?b', 'x']}))
    assert ['p', '?b', '?b'] in [g.positive_preconditions[0] for g in grounded]
    assert ['p', 'x', 'x'] in [g.positive_preconditions[0] for g in grounded]


def test_bug_label_distinguishes_groundings_of_one_action():
    """Grounded actions share .name, so name alone cannot key a transition."""
    action = Action('move', [['?p', 'pos']], [], [], [['at', '?p']], [])
    assert {label(act) for act in action.groundify({'pos': ['p1', 'p2']})} == {'move(p1)', 'move(p2)'}


def test_label_of_a_parameterless_action_is_its_name():
    assert label(Action('wait', [], [], [], [], [])) == 'wait'


def test_groundify_does_not_mutate_the_lifted_action():
    action = Action('move', [['?p', 'pos']], [['at', '?p']], [], [], [])
    list(action.groundify({'pos': ['p1', 'p2']}))
    assert action.positive_preconditions == [['at', '?p']]


# ------------------------------------------------------- transition system

def test_bug_state_keys_are_canonical(example_system):
    """States are sets of facts, so their keys must not depend on insert order.

    Order-sensitive keys used to report 19 states for this example; the
    reachable state space actually has 9.
    """
    transitions, _ = example_system
    assert len(transitions) == 9
    for state in transitions:
        assert list(state) == sorted(state)
    assert len({frozenset(state) for state in transitions}) == len(transitions)


def test_bug_edges_into_visited_states_are_recorded(example_system):
    """Edges used to be dropped whenever the successor had been seen before,
    which yields a spanning tree rather than the transition system."""
    transitions, _ = example_system
    assert sum(len(edges) for edges in transitions.values()) == 33
    assert all(transitions[state] for state in transitions)


def test_bug_self_loops_are_recorded(example_system):
    """An action whose effects already hold yields a self-loop, not nothing."""
    transitions, _ = example_system
    assert any(succ == state for state, edges in transitions.items() for succ in edges.values())


def test_every_successor_is_itself_a_state(example_system):
    transitions, _ = example_system
    for edges in transitions.values():
        for successor in edges.values():
            assert successor in transitions


def test_initial_state_is_a_key_of_the_system(example_system):
    transitions, initial_state = example_system
    assert initial_state in transitions


def test_the_goal_is_reachable_in_the_bundled_example(example_system):
    transitions, _ = example_system
    goal = {('netaccess_10_10_10_1_tcp_22', 's'), ('execcode_10_10_10_1_someuser', 's'),
            ('netaccess_10_10_10_14_tcp_25', 's'), ('execcode_10_10_10_14_someuser', 's')}
    assert any(goal <= set(state) for state in transitions)


def test_bug_fact_arguments_are_preserved(tmp_path):
    """States used to be keyed by predicate name only, collapsing
    (at ana p1) and (at ana p2) into a single fact."""
    transitions, initial_state = Constructor().construct(*grid(tmp_path))
    assert ('at', 'ana', 'p1') in initial_state
    assert len(transitions) == 2  # ana at p1, ana at p2


def test_bug_goal_true_in_initial_state_does_not_crash(tmp_path):
    """construct() used to return [], so unpacking two values raised."""
    transitions, initial_state = Constructor().construct(*grid(tmp_path, """
(define (problem grid3)
  (:domain grid)
  (:objects ana - agent p1 p2 - pos)
  (:init (at ana p1) (adjacent p1 p2) (adjacent p2 p1))
  (:goal (and (at ana p1)))
)
"""))
    assert initial_state in transitions


def test_bug_a_satisfied_goal_is_not_a_search_cutoff(tmp_path):
    """The goal holding initially used to abandon the rest of the state space.

    A goal state reached later in the search is expanded normally, so a goal
    state reached immediately must be too.
    """
    transitions, initial_state = Constructor().construct(*grid(tmp_path, """
(define (problem grid4)
  (:domain grid)
  (:objects ana - agent p1 p2 - pos)
  (:init (at ana p1) (adjacent p1 p2) (adjacent p2 p1))
  (:goal (and (at ana p1)))
)
"""))
    # ana can still walk to p2 and back, so both states are reachable.
    assert len(transitions) == 2
    assert transitions[initial_state]['move(ana,p1,p2)'] in transitions


def test_bug_duplicate_init_facts_are_deduplicated(tmp_path):
    """A repeated :init fact used to make the initial state non-canonical.

    apply() never emits a repeated fact, so only the initial state carried
    the duplicate -- leaving it a phantom node no action could return to.
    """
    transitions, initial_state = Constructor().construct(*grid(tmp_path, """
(define (problem dup)
  (:domain grid)
  (:objects ana - agent p1 p2 - pos)
  (:init (at ana p1) (at ana p1) (adjacent p1 p2) (adjacent p2 p1))
  (:goal (and (at ana p2)))
)
"""))
    assert initial_state.count(('at', 'ana', 'p1')) == 1
    assert len(transitions) == 2
    # Walking to p2 and back returns to the initial key, which only holds if
    # that key is canonical.
    there = transitions[initial_state]['move(ana,p1,p2)']
    assert transitions[there]['move(ana,p2,p1)'] == initial_state


def test_delete_effects_are_applied(tmp_path):
    transitions, initial_state = Constructor().construct(*grid(tmp_path))
    successor = transitions[initial_state]['move(ana,p1,p2)']
    assert ('at', 'ana', 'p2') in successor
    assert ('at', 'ana', 'p1') not in successor


def test_several_groundings_of_one_action_stay_distinct(tmp_path):
    """Two moves are applicable at once; keying by name would keep only one."""
    transitions, initial_state = Constructor().construct(*grid(tmp_path, """
(define (problem fork)
  (:domain grid)
  (:objects ana - agent p1 p2 p3 - pos)
  (:init (at ana p1) (adjacent p1 p2) (adjacent p1 p3))
  (:goal (and (at ana p3)))
)
"""))
    assert set(transitions[initial_state]) == {'move(ana,p1,p2)', 'move(ana,p1,p3)'}


def test_negative_preconditions_block_an_action():
    constructor = Constructor()
    state = [['at', 'ana', 'p1']]
    assert constructor.applicable(state, [['at', 'ana', 'p1']], [])
    assert not constructor.applicable(state, [], [['at', 'ana', 'p1']])


def test_convert_is_order_independent():
    assert convert([('b',), ('a',)]) == convert([('a',), ('b',)])


def test_convert_deduplicates():
    assert convert([('a',), ('a',), ('b',)]) == (('a',), ('b',))


def test_identifiers_colliding_with_builtin_names_are_fine(tmp_path):
    """A predicate or type may legitimately be named like a builtin."""
    domain = write(tmp_path, 'dom.pddl', """
(define (domain odd)
  (:requirements :strips :typing)
  (:predicates (items ?x - keys) (values ?x - keys))
  (:action get :parameters (?x - keys)
    :precondition (and (items ?x)) :effect (and (values ?x))))
""")
    problem = write(tmp_path, 'prob.pddl', """
(define (problem odd1)
  (:domain odd)
  (:objects a b - keys)
  (:init (items a) (items b))
  (:goal (and (values a) (values b))))
""")
    transitions, _ = Constructor().construct(domain, problem)
    assert len(transitions) == 4
    assert sum(len(edges) for edges in transitions.values()) == 8


# ---------------------------------------------------------------------- cli

def test_cli_writes_a_pickle(tmp_path):
    for name in ('PDDL.py', 'action.py', 'constructor.py'):
        shutil.copy(os.path.join(ROOT, name), str(tmp_path / name))
    result = subprocess.run([sys.executable, 'constructor.py', DOMAIN, PROBLEM],
                            capture_output=True, text=True, cwd=str(tmp_path))
    assert result.returncode == 0, result.stderr
    assert 'The total number of states' in result.stdout
    with open(str(tmp_path / 'transitions.pickle'), 'rb') as handle:
        transitions, initial_state = pickle.load(handle)
    assert initial_state in transitions
    assert len(transitions) == 9
