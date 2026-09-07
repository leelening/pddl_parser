#!/usr/bin/env python
# Four spaces as indentation [no tabs]

from PDDL import PDDL_Parser
import pickle


def label(act):
    # A ground action's identity is its name *and* its arguments: groundify
    # gives every grounding the same .name, so keying transitions by name
    # alone silently merged distinct groundings.
    if not len(act.parameters):
        return act.name
    return act.name + '(' + ','.join(str(a) for a in act.parameters) + ')'


def convert(state):
    # Canonical, hashable key for a state.  Sorting matters: `apply` appends
    # facts in action-application order, so the same set of facts reached by
    # two different action orders must not count as two distinct states.
    # Deduplicating matters too: `apply` never emits a repeated fact, so a
    # repeated fact in `:init` would leave the initial state under a key no
    # action could ever produce again.
    # The whole predicate is kept -- keeping only i[0] collapsed every
    # grounding of a predicate (e.g. (at ana p1) and (at bob p2)) into one key.
    return tuple(sorted(set(tuple(i) for i in state)))


class Constructor:

    #-----------------------------------------------
    # Construct
    #-----------------------------------------------

    def construct(self, domain, problem):
        # Parser
        parser = PDDL_Parser()
        parser.parse_domain(domain)
        parser.parse_problem(problem)
        # Parsed data
        state = parser.state
        initial_state = convert(state)
        # The goal is not a search cutoff.  The result describes every state
        # reachable from the initial one, and a goal state reached later in
        # the search is expanded like any other, so returning early when the
        # goal already holds threw away the rest of the state space (and, by
        # returning [], made the two-value unpacking every caller does raise).
        # Grounding process
        ground_actions = []
        for action in parser.actions:
            for act in action.groundify(parser.objects):
                ground_actions.append(act)
        # Search
        visited = {initial_state}
        need_visit = [state]
        transitions = dict()
        while need_visit:
            state = need_visit.pop(0)
            key = convert(state)
            transitions[key] = dict()
            for act in ground_actions:
                if self.applicable(state, act.positive_preconditions, act.negative_preconditions):
                    new_state = self.apply(state, act.add_effects, act.del_effects)
                    new_key = convert(new_state)
                    # Record the edge for every applicable action, not only for
                    # actions that discover a previously unseen state -- doing
                    # the latter yields a spanning tree, not the transition
                    # system.
                    transitions[key][label(act)] = new_key
                    if new_key not in visited:
                        visited.add(new_key)
                        need_visit.append(new_state)
        return [transitions, initial_state]

    #-----------------------------------------------
    # Applicable
    #-----------------------------------------------

    def applicable(self, state, positive, negative):
        for i in positive:
            if i not in state:
                return False
        for i in negative:
            if i in state:
                return False
        return True

    #-----------------------------------------------
    # Apply
    #-----------------------------------------------

    def apply(self, state, positive, negative):
        new_state = []
        for i in state:
            if i not in negative:
                new_state.append(i)
        for i in positive:
            if i not in new_state:
              new_state.append(i)
        return new_state

# ==========================================
# Main
# ==========================================
if __name__ == '__main__':
    import sys, time
    start_time = time.time()
    domain = sys.argv[1]
    problem = sys.argv[2]
    # domain = '../graphs/0/domain.pddl'
    # problem = '../graphs/0/problem.pddl'
    constructor = Constructor()
    [transitions, initial_state] = constructor.construct(domain, problem)
    print('\nThe total number of states: ', '\t\t', len(transitions.keys()))
    print('\nTime: ', '\t\t', str(time.time() - start_time) + 's')

    # count the transitions
    edge_count = 0
    for s in transitions:
        for a in transitions[s]:
            n_s = transitions[s][a]
            edge_count+=1
    print('\nThe total number of transitions: ', '\t\t', edge_count)


    with open('transitions.pickle', 'wb') as handle:
        pickle.dump([transitions, initial_state], handle, protocol=pickle.HIGHEST_PROTOCOL)
