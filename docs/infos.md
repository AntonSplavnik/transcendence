
### Sources for Documentation

Mozilla foundation, especially for how to design the frontend

### Tips

- install the npm extra Modules for:
   esLint
   Type Checking

- be extremely strict with Typescript
    a funtion definition should contain:
      - sync or async
      - return and type of return
      - define input type

- fastify instance:
  --> registering all Modules on fastify instance
  -fp fastify plugins -> makes internal typing connect

some other group used REST APIs

- get a really clear idea of the flow:
    define all schemas centralized:
    who sends what to whom?

### Username / Nickname Constraints

in backend:

    pub nickname: String,
    #[validate(length(
        min = 8,
        max = 128,
        message = "Must be between 8 and 128 characters long."
