### the question mark operator (?.)

    if (error.response?.status)

This means that response may be undefined.
In that case, the expression will short-circuit and return undefined instead of throwing an error, which it would have done if we tried to access status directly on an undefined response.

### Arrow functions

Arrow funcitons are anonymous functions defined using the `=>` syntax. In Python, they are similar to lambda functions.

arrow functions provide a more concise syntax for writing functions in TypeScript (and JavaScript). They also lexically bind the `this` value, which can be useful in certain contexts.
Binding the this value means that the value of this inside the arrow function is determined by the surrounding context where the arrow function is defined, rather than how the function is called.

they can be expressed like so:

```TypeScript
(parameters) => { statements }    // Explicit return

const add = (a: number, b:  number): number => {
    return a + b;
};
```

```TypeScript
 (parameters) => expression        // Implicit return

 const add = (a:  number, b: number) => a + b;

```

for my purposes, always use explicit return syntax, and type all parameters and return types.
This makes it so that typescript can do syntax checking on everything.

```TypeScript
const handler = (response: AxiosResponse): AxiosResponse => {
return response;
};
//                ^^^^^^^^^^^^^^^          ^^^^^^^^^^^^  ^^^
//                parameter type           return type   arrow separating params from body
```

### Imports

1. Import everything as a namespace:

```typescript
import * as authApi from "../api/auth";
// All exports from ../api/auth are available as properties of authApi, e.g., authApi.login()
```

1. Import specific named exports:

```typescript
import { login, logout } from "../api/auth";
// Only the 'login' and 'logout' exports are imported directly
```

1. Import a default export:

```typescript
import AuthService from "../api/auth";
// Imports the default export from ../api/auth as AuthService
```

1. Import both default and named exports:

```typescript
import AuthService, { login } from "../api/auth";
// Imports the default export as AuthService and the named export 'login'
```

1. Import for side effects only:

```typescript
import "../api/auth";
// Runs the module, but does not import any bindings
```
