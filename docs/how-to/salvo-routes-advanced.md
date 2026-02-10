# Advanced Salvo Routes

This guide covers more advanced topics for building robust API endpoints in Salvo, including OpenAPI documentation, error handling, input validation, and database access.

## 1. OpenAPI Documentation (`#[endpoint]`)

To automatically generate API documentation (Scalar, Swagger UI, ...), use the `#[endpoint]` macro instead of `#[handler]`. This allows you to describe your API structure.

```rust
use salvo::oapi::extract::JsonBody;
use salvo::prelude::*;
use serde::{Deserialize, Serialize};
use salvo::oapi::ToSchema; // Required for OpenAPI

#[derive(Deserialize, Serialize, ToSchema)]
struct CreateTask {
    title: String,
    description: String,
}

#[derive(Serialize, ToSchema)]
struct TaskResponse {
    id: i32,
    title: String,
    completed: bool,
}

// Use #[endpoint] to expose this handler to OpenAPI
// You can add summary, description, and other metadata
#[endpoint(
    summary = "Create a new task",
    description = "Creates a task and returns the created task details"
)]
async fn create_task(task: JsonBody<CreateTask>) -> Json<TaskResponse> {
    let task = task.into_inner();

    // ... logic to save task ...

    Json(TaskResponse {
        id: 1,
        title: task.title,
        completed: false,
    })
}
```

## 2. Input Validation

We use the `validator` crate to ensure data is correct before processing it.

```rust
use validator::Validate;
use salvo::oapi::extract::JsonBody;
use salvo::prelude::*;

#[derive(Deserialize, Validate, ToSchema)]
struct UserSignup {
    #[validate(email(message = "Invalid email format"))]
    email: String,

    #[validate(length(min = 8, message = "Password must be at least 8 chars"))]
    password: String,
}

#[endpoint]
async fn signup(user: JsonBody<UserSignup>) -> Result<StatusCode, String> {
    let user_data = user.into_inner();

    // Validate the struct
    if let Err(e) = user_data.validate() {
        return Err(format!("Validation error: {}", e));
    }

    Ok(StatusCode::CREATED)
}
```

## 3. Error Handling with `Result`

Instead of panicking or returning simple strings, return a `Result`. This allows you to return successful data or an error status code/message.

In our project, we often use a custom error type (like `ApiError`) that converts to a response automatically.

```rust
use salvo::prelude::*;

// Simple example using standard Result
#[endpoint]
async fn divide(req: &mut Request) -> Result<String, StatusCode> {
    let a = req.query::<f64>("a").unwrap_or(0.0);
    let b = req.query::<f64>("b").unwrap_or(0.0);

    if b == 0.0 {
        // Return a 400 Bad Request status
        return Err(StatusCode::BAD_REQUEST);
    }

    Ok(format!("Result: {}", a / b))
}
```

## 4. Accessing the Database

The database is injected into each request via a hoop. Handlers can receive a `Db` argument, which is extracted automatically by `#[handler]` and `#[endpoint]`.

```rust
use crate::db::Db;
use diesel::prelude::*;
use salvo::prelude::*;

#[endpoint]
async fn get_users(db: Db) -> Result<Json<Vec<String>>, StatusCode> {
    // Use the async database API and run diesel queries inside the closure
    let users: Vec<String> = db
        .read(|conn| async move {
            // ... perform diesel queries using `conn` ...
            Ok(vec!["Alice".to_string(), "Bob".to_string()])
        })
        .await
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?
        .map_err(|_| StatusCode::INTERNAL_SERVER_ERROR)?;

    Ok(Json(users))
}
```

## 5. Authentication (Guards)

To protect a route so only logged-in users can access it, we use "Hoops" (Middleware).

```rust
use salvo::prelude::*;

#[endpoint]
async fn protected_data() -> &'static str {
    "This data is for logged-in users only."
}

// In your router configuration:
// Router::with_path("protected")
//     .hoop(crate::hoops::auth::auth_check) // Apply the auth middleware
//     .get(protected_data);
```
