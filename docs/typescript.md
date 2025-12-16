### the question mark operator (?.)

    if (error.response?.status)

This means that response may be undefined.
In that case, the expression will short-circuit and return undefined instead of throwing an error, which it would have done if we tried to access status directly on an undefined response.
