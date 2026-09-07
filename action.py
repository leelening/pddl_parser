#!/usr/bin/env python
# Four spaces as indentation [no tabs]

import itertools

class Action:

    def __init__(self, name, parameters, positive_preconditions, negative_preconditions, add_effects, del_effects):
        self.name = name
        self.parameters = parameters
        self.positive_preconditions = positive_preconditions
        self.negative_preconditions = negative_preconditions
        self.add_effects = add_effects
        self.del_effects = del_effects

    def __str__(self):
        return 'action: ' + self.name + \
        '\n  parameters: ' + str(self.parameters) + \
        '\n  positive_preconditions: ' + str(self.positive_preconditions) + \
        '\n  negative_preconditions: ' + str(self.negative_preconditions) + \
        '\n  add_effects: ' + str(self.add_effects) + \
        '\n  del_effects: ' + str(self.del_effects) + '\n'

    def __eq__(self, other):
        return self.__dict__ == other.__dict__

    # Defining __eq__ without __hash__ makes the class unhashable on Python 3.
    def __hash__(self):
        return hash(self.name)

    def groundify(self, objects):
        if not self.parameters:
            yield self
            return
        type_map = []
        variables = []
        # `type` would shadow the builtin.
        for var, var_type in self.parameters:
            if var_type not in objects:
                raise Exception('Action ' + self.name + ' declares parameter ' + var +
                    ' of type ' + var_type + ', but the problem file defines no objects'
                    ' of that type')
            type_map.append(objects[var_type])
            variables.append(var)
        for assignment in itertools.product(*type_map):
            positive_preconditions = self.replace(self.positive_preconditions, variables, assignment)
            negative_preconditions = self.replace(self.negative_preconditions, variables, assignment)
            add_effects = self.replace(self.add_effects, variables, assignment)
            del_effects = self.replace(self.del_effects, variables, assignment)
            yield Action(self.name, assignment, positive_preconditions, negative_preconditions, add_effects, del_effects)

    def replace(self, group, variables, assignment):
        # Substitute every variable at once. Replacing them one at a time
        # re-scans tokens already substituted, so a value that happens to
        # match a later variable name gets replaced a second time.
        substitution = dict(zip(variables, assignment))
        return [[substitution.get(token, token) for token in pred] for pred in group]

if __name__ == '__main__':
    a = Action('move', [['?ag', 'agent'], ['?from', 'pos'], ['?to', 'pos']],
        [['at', '?ag', '?from'], ['adjacent', '?from', '?to']],
        [['at', '?ag', '?to']],
        [['at', '?ag', '?to']],
        [['at', '?ag', '?from']]
    )
    print(a)

    objects = {
        'agent': ['ana','bob'],
        'pos': ['p1','p2']
    }
    for act in a.groundify(objects):
        print(act)