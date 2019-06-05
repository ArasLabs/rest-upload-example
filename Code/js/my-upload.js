/**
 * This is the main function of the rest-upload-example project. 
 * When the user clicks "submit" on the main form, this function retrieves 
 * the user's input, validates their input, and then uploads the selected 
 * file to the Aras Innovator vault.
 */
async function submitForm() {
    try {
        hideAlert();

        // get and validate the connection input provided by the end user
        var creds = getConnectionInput();
        creds = validateConnectionInput(creds);

        // get the file selected by the end user
        var my_file = getFileInput();

        // get an OAuth token from the server and add to creds
        creds.token = await getOAuthTokenSP15(creds);
        var auth_headers = getOAuthHeaders(creds);          // use this line for OAuth token authentication (preferred)

        // get a transaction id for uploading a file to the vault server
        var transaction_url = creds.url + "/vault/odata/vault.BeginTransaction";
        var transaction_res = await httpReq("POST", transaction_url, auth_headers);
        var transaction_obj = getJSON(transaction_res);
        var transaction_id = transaction_obj.transactionId;

        // upload the selected file using the transaction id
        var file_id = generateNewGuid();
        var upload_res = await uploadFile(my_file, file_id, transaction_id, creds, auth_headers);

        // commit the vault transaction to finish the file upload
        var commit_res = await commitTransaction(my_file, file_id, transaction_id, creds, auth_headers);

        // parse commit response
        var commit_str = commit_res.toString();
        commit_str = commit_str.substring(commit_str.indexOf("{"), commit_str.lastIndexOf("}") + 1);
        var commit_obj = JSON.parse(commit_str);

        // notify the user that the file upload succeeded
        return reportSuccess("Uploaded file '" + commit_obj.filename + "' with id '" + commit_obj.id + "'");

    } catch (err) {
        return reportError(err.message);
    }

}


/**** request helpers ********************************************************/

/**
 * Sends an HTTP call to the specified url.
 *
 * @param {*} type - HTTP call type. (GET or POST for this sample project)
 * @param {*} url - url to use for the HTTP call
 * @param {*} headers - an array of objects representing headers. Ex: [{name: "Content-Type", value: "application/json"}, {name: "AUTHUSER", value: "admin"}]
 * @param {*} body - body content of the HTTP call
 */
async function httpReq(type, url, headers, body) {
    var httpRequest = new XMLHttpRequest();
    return new Promise(function (resolve, reject) {
        // resolve or reject the promise when the response comes back
        httpRequest.onreadystatechange = function () {
            if (httpRequest.readyState == 4 && httpRequest.status == 200) {
                // resolve the promise and return the response text
                resolve(httpRequest.responseText);

            }
            else if (httpRequest.readyState == 4) {
                // reject the promise and return an error
                reject(new Error(httpRequest.status + " (" + httpRequest.statusText + ") from " + url));
            }
        };

        // send the request
        httpRequest.open(type, url, true);
        headers = headers || [];
        for (var i = 0; i < headers.length; i++) {
            var header = headers[i];
            httpRequest.setRequestHeader(header.name, header.value);
        }
        httpRequest.send(body);
    });
}

/**
 * Retrieves a token from the Innovator auth server using the provided user credentials.
 * Supports Innovator 11 SP15.
 */
async function getOAuthTokenSP15(creds) {
    try {
        // get the OAuth server url
        var discovery_url = creds.url + "/Server/OAuthServerDiscovery.aspx";
        var oauth_res = await httpReq("GET", discovery_url);
        var oauth_obj = getJSON(oauth_res);
        var oauth_url = oauth_obj.locations[0].uri;

        // get the OAuth server token endpoint url
        var get_endpoint_url = oauth_url + ".well-known/openid-configuration";
        var endpoint_res = await httpReq("GET", get_endpoint_url);
        var endpoint_obj = getJSON(endpoint_res);
        var token_url = endpoint_obj.token_endpoint;

        // build the OAuth token request
        var token_headers = [];
        token_headers.push({
            name: "content-type",
            value: "application/x-www-form-urlencoded"
        });

        var token_params = [];
        token_params.push("grant_type=password");
        token_params.push("scope=Innovator");
        token_params.push("client_id=IOMApp");
        token_params.push("username=" + creds.user);
        token_params.push("password=" + creds.pwd);
        token_params.push("database=" + creds.db);

        var token_body = token_params.join("&");

        // get the token
        var token_res = await httpReq("POST", token_url, token_headers, token_body);
        var token_obj = getJSON(token_res);
        var token = token_obj.access_token;

        return token;

    } catch (err) {
        throw new Error("Error in getOAuthToken: " + err.message);
    }
}

/**
 * Uploads the user's file to the vault server, breaking it into smaller chunks if necessary. 
 * When the upload is finished, we commit the transaction before returning.
 * 
 * @param {*} file - the file object to upload
 * @param {*} file_id - the id for the new File item in Aras
 * @param {*} transaction_id - the transaction_id for the vault server
 * @param {*} creds - an object containing the user's connection info (url, database, etc.)
 * @param {*} auth_headers - an array of objects representing the headers required for an Innovator REST call
 * @param {*} chunk_size - the max size of file content to upload in one call (bytes). Default value is 10,000. If the file is larger than chunk_size, we'll break up the file and send it in multiple requests.
 */
async function uploadFile(file, file_id, transaction_id, creds, auth_headers, chunk_size = 10000) {
    var results = [];
    var size = file.size;
    var start = 0;
    var end = 0;

    while (end < size - 1) {
        var end = start + chunk_size;
        if (size - end < 0) {
            end = size;
        }

        // get an array of headers for this upload request
        var headers = getUploadHeaders(auth_headers, escapeURL(file.name), start, end - 1, size, transaction_id);

        // make the request to upload this file content
        var upload_url = creds.url + "/vault/odata/vault.UploadFile?fileId=" + file_id;
        var chunk = file.slice(start, end);
        var response = await httpReq("POST", upload_url, headers, chunk);
        results.push(response);

        start += chunk_size;
    }

    return Promise.all(results);
}

/**
 * Makes the final call to commit the file upload transaction to the vault server.
 * 
 * @param {*} file - the file object to upload
 * @param {*} file_id - the id for the new File item in Aras
 * @param {*} transaction_id - the transaction_id for the vault server
 * @param {*} creds - an object containing the user's connection info (url, database, etc.)
 * @param {*} auth_headers - an array of objects representing the headers required for an Innovator REST call
 */
async function commitTransaction(file, file_id, transaction_id, creds, auth_headers) {
    // build the headers and body for the commit request
    var boundary = "batch_" + file_id;
    var commit_headers = getCommitHeaders(boundary, transaction_id, auth_headers);
    var commit_url = creds.url + "/vault/odata/vault.CommitTransaction";

    // it's important to use the \r\n end of line character, otherwise commit will fail
    var EOL = "\r\n";

    // build the commit body string
    var commit_body = "--";
    commit_body += boundary;
    commit_body += EOL;
    commit_body += "Content-Type: application/http";
    commit_body += EOL;
    commit_body += EOL;
    commit_body += "POST " + creds.url + "/Server/odata/File HTTP/1.1";
    commit_body += EOL;
    commit_body += "Content-Type: application/json";
    commit_body += EOL;
    commit_body += EOL;
    commit_body += '{"id":"' + file_id + '",';
    commit_body += '"filename":"' + file.name + '",';
    commit_body += '"file_size":' + file.size + ',';
    commit_body += '"Located":[{"file_version":1,"related_id":"67BBB9204FE84A8981ED8313049BA06C"}]}';
    commit_body += EOL;
    commit_body += "--" + boundary + "--";

    // send the commit request to the vault server
    var result = await httpReq("POST", commit_url, commit_headers, commit_body);
    return result;
}


/**** header helpers *********************************************************/

/**
 * Deprecated - do not use.
 * 
 * Returns an array of objects representing the headers required for an Innovator REST call using basic authentication (password rather than OAuth token).
 * Note that Aras Innovator 12.0 only supports OAuth. 
 * 
 * @param {*} creds - an object containing the connection data provided by the end user. See getConnectionInput for an example.
 */
function getBasicAuthHeaders(creds) {
    var msg = "getBasicAuthHeaders() is deprecated in this release. Innovator 12.0 does not support basic authentication. Use OAuth token authentication instead.";
    throw new Error(msg);
}

/**
 * Returns an array of objects representing the headers required for an Innovator REST call using OAuth
 * 
 * @param {*} creds - an object containing the connection data provided by the end user. See getConnectionInput for an example.
 */
function getOAuthHeaders(creds) {
    var oauth_headers = [];
    oauth_headers.push({
        name: "authorization",
        value: "Bearer " + creds.token
    });

    return oauth_headers;
}

/**
 * Returns an array of objects representing the headers required to upload a file to the vault server
 * 
 * @param {*} auth_headers - an array of objects representing the headers required for an Innovator REST call
 * @param {*} escaped_name - the name of the file to upload, with special characters encoded (ex. spaces replaced with '%20')
 * @param {*} start_range - the first index of the file chunk
 * @param {*} end_range - the last index of the file chunk
 * @param {*} file_size - the size of the file chunk
 * @param {*} transaction_id - the transaction id for this upload request
 */
function getUploadHeaders(auth_headers, escaped_name, start_range, end_range, file_size, transaction_id) {
    // start the upload headers array with a clone of the auth_headers array
    var headers = auth_headers.slice(0);

    // then add the headers needed for the file chunk upload
    headers.push({
        name: "Content-Disposition",
        value: "attachment; filename*=utf-8''" + escaped_name
    });
    headers.push({
        name: "Content-Range",
        value: "bytes " + start_range + "-" + end_range + "/" + file_size
    });
    headers.push({
        name: "Content-Type",
        value: "application/octet-stream"
    });
    headers.push({
        name: "transactionid",
        value: transaction_id
    });

    return headers;
}

/**
 * Returns an array of objects representing the headers required to commit a vault server transaction
 * 
 * @param {*} boundary - a specific string for marking the beginning and end of commit content
 * @param {*} transaction_id - the transaction id for this upload request
 * @param {*} auth_headers - an array of objects representing the headers required for an Innovator REST call
 */
function getCommitHeaders(boundary, transaction_id, auth_headers) {
    var commit_headers = [];
    commit_headers.push({
        name: "Content-Type",
        value: "multipart/mixed; boundary=" + boundary
    });
    commit_headers.push({
        name: "transactionid",
        value: transaction_id
    });
    auth_headers.forEach(element => {
        commit_headers.push(element);
    });

    return commit_headers;
}


/**** collect & validate input ***********************************************/

/**
 * Retrieves the connection data provided by the end user. 
 * Returns the connection info in an object. Example:
 * {
 *    url: "http://localhost/InnovatorServer",
 *     db: "InnovatorSolutions",
 *   user: "admin",
 *    pwd: MD5 hash of password entered by user
 * } 
 */
function getConnectionInput() {
    var urlField = document.getElementById("inn-url");
    var dbField = document.getElementById("inn-db");
    var userField = document.getElementById("inn-user");
    var pwdField = document.getElementById("inn-pwd");

    var creds = {};
    creds.url = urlField.value;
    creds.db = dbField.value;
    creds.user = userField.value;
    creds.pwd = pwdField.value ? md5(pwdField.value) : null;

    return creds;
}

/**
 * Checks the connection data to make sure each property has a value.
 * Returns an error if a property doesn't have a value. Otherwise, returns the connection data object that was passed in.
 * 
 * @param {*} creds - an object containing the connection data provided by the end user. See getConnectionInput for an example.
 */
function validateConnectionInput(creds) {
    if (!creds.url) {
        throw new Error("Please enter an Innovator url.");
    }
    if (!creds.db) {
        throw new Error("Please enter a database name.");
    }
    if (!creds.user) {
        throw new Error("Please enter a user name.");
    }
    if (!creds.pwd) {
        throw new Error("Please enter a password.");
    }

    return creds;
}

/**
 * Retrieves the file selected by the end user. 
 * Returns a file object if a file has been selected. Otherwise returns null.
 */
function getFileInput() {
    var file = document.getElementById("file-field").files[0];
    if (file === undefined) {
        throw new Error("Please select a file to upload.");
    }

    return file;
}


/**** misc utilities *********************************************************/

/**
 * Parses an XMLHttpRequest as JSON and returns the JSON object
 * 
 * @param {*} http_response - XMLHttpRequest.responseText
 */
function getJSON(http_response) {
    try {
        var json = JSON.parse(http_response.toString());
        return json;

    } catch (err) {
        throw new Error("Error in getJSON: " + err.message);
    }
}

/**
 * Returns a new 32 character GUID we can use as an Aras Item id
 */
function generateNewGuid() {
    function randomDigit() {
        if (crypto && crypto.getRandomValues) {
            var rands = new Uint8Array(1);
            crypto.getRandomValues(rands);
            return (rands[0] % 16).toString(16);
        } else {
            return ((Math.random() * 16) | 0).toString(16);
        }
    }
    var crypto = window.crypto || window.msCrypto;
    return 'xxxxxxxxxxxx4xxx8xxxxxxxxxxxxxxx'.replace(/x/g, randomDigit).toUpperCase();
}

/**
 * Escapes the following characters in a url: %, ' ', ', !, ", #, $, &, (, ), *, +, ?
 * 
 * @param {*} url - the url string we need to escape
 */
function escapeURL(url) {
    url = url.split('%').join('%25');
    url = url.split(' ').join('%20');
    url = url.split("'").join('%27');
    url = url.split('!').join('%21');
    url = url.split('"').join('%22');
    url = url.split('#').join('%23');
    url = url.split('$').join('%24');
    url = url.split('&').join('%26');
    url = url.split('(').join('%28');
    url = url.split(')').join('%29');
    url = url.split('*').join('%2A');
    url = url.split('+').join('%2B');
    url = url.split('?').join('%3F');

    return url;
}

/**
 * Apply the success style to the alert control and show the specified message.
 * 
 * @param {*} msg - message string to display
 */
function reportSuccess(msg) {
    console.log(msg);
    showAlert();
    $('#my-alert').removeClass("alert-danger");
    $('#my-alert').addClass("alert-success");
    $('#alert-bold').html("Success!");
    $('#alert-msg').html(msg);
}

/**
 * Apply the danger style to the alert control and show the specified message.
 * 
 * @param {*} msg - message string to display
 */
function reportError(msg) {
    console.log(msg);
    showAlert();
    $('#my-alert').removeClass("alert-success");
    $('#my-alert').addClass("alert-danger");
    $('#alert-bold').html("Warning!");
    $('#alert-msg').html(msg);
}

/**
 * Hide the alert control.
 */
function hideAlert() {
    $('#my-alert').removeClass("show");
    $('#my-alert').addClass("hide");
}

/**
 * Show the alert control.
 */
function showAlert() {
    $('#my-alert').removeClass("hide");
    $('#my-alert').addClass("show");
}
