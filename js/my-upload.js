/**
 * This is the main function of the rest-upload-example project. 
 * When the user clicks "submit" on the main form, this function retrieves 
 * the user's input, validates their input, and then uploads the selected 
 * file to the Aras Innovator vault.
 */
function submitForm() {
    // get and validate the connection input provided by the end user
    var creds = getConnectionInput();
    creds = validateConnectionInput(creds);
    if (creds instanceof Error) {
        alert(creds.message);
        return;
    }

    // get the file selected by the end user
    var my_file = getFileInput();
    if (my_file === null) {
        alert("Please select a file to upload.");
        return;
    }

    var transaction_id = "";
    var file_id = generateNewGuid();
    var auth_headers;

    // get an OAuth token from the server
    var auth_res = getOAuthToken(creds);

    // get a transaction id for uploading a file to the vault server
    var transaction_res = auth_res.then(
        function (auth_res) {
            var response = auth_res.responseText.toString();
            var response_object = JSON.parse(response);
            var token = response_object.access_token;

            // add the token to creds
            creds.token = token;
            auth_headers = getOAuthHeaders(creds);

            return httpReq("POST", creds.url + "/vault/odata/vault.BeginTransaction", auth_headers);
        }
    );

    // upload the selected file using the transaction id
    var upload_res = transaction_res.then(
        function(transaction_res) {
            var response = transaction_res.responseText.toString();
            var response_object = JSON.parse(response);
            transaction_id = response_object.transactionId;

            return uploadFile(my_file, file_id, transaction_id, creds, auth_headers);
        }
    );

    // commit the vault transaction to finish the file upload
    var commit_res = upload_res.then(
        function(upload_res){
            return commitTransaction(my_file, file_id, transaction_id, creds, auth_headers);
        }
    );

    // notify the user that the file upload succeeded
    var res = commit_res.then(
        function(commit_res) {
            var response = commit_res.responseText.toString();
            var response_json = response.substring(response.indexOf("{"), response.lastIndexOf("}") + 1);
            var response_object = JSON.parse(response_json);

            // inform the user that the upload and commit were successful
            alert("Successfully uploaded file '" + response_object.filename + "' with id '" + response_object.id + "'");
        }
    )
}


/**** request helpers ********************************************************/

/**
 * Sends an HTTP call to the specified url.
 *
 * @param {*} type - HTTP call type. (GET or POST for this sample project)
 * @param {*} url - url to use for the HTTP call
 * @param {*} headers - an array of objects representing headers. Ex: [{name: "Content-Type", value: "application/json"}, {name: "AUTHUSER", value: "admin"}]
 * @param {*} body - body content of the HTTP call
 * @param {*} attempts - number of times we should attempt this call. Default value is 0. If attempts = 0, the call will be made synchronously.
 */
function httpReq(type, url, headers, body, attempts = 0) {
    return new Promise(function (resolve, reject) {
        // start building the request
        var httpRequest = new XMLHttpRequest();
        if (attempts == 0) {
            httpRequest.open(type, url, true);
        } else {
            httpRequest.open(type, url, false);
        }

        // add any headers passed to function
        headers = headers || [];
        for (var i = 0; i < headers.length; i++) {
            var header = headers[i];
            httpRequest.setRequestHeader(header.name, header.value);
        }

        // send the request
        httpRequest.send(body);

        // resolve or reject the promise when the response comes back
        httpRequest.onreadystatechange = function () {
            if (httpRequest.readyState == 4 && httpRequest.status == 200) {
                // resolve the promise and return the request object
                resolve(httpRequest);

            } else if (httpRequest.readyState == 4 && attempts !== 0) {
                // we have more attempts left, retry
                return httpReq(type, url, headers, body, attempts - 1);

            } else if (httpRequest.readyState == 4 && httpRequest.status == 400) {
                // reject the promise and return an error
                reject(new Error(httpRequest.statusText));
            }
        };
    });
}

/**
 * Retrieves a token from the Innovator auth server using the provided user credentials.
 * 
 * @param {*} creds - an object containing the user's connection info (url, database, etc.)
 */
function getOAuthToken(creds) {
    // get the OAuth server url
    var discovery_url = creds.url + "/Server/OAuthServerDiscovery.aspx";
    var oauth_res = httpReq("GET", discovery_url);

    // get the OAuth server token endpoint
    var endpoint_res = oauth_res.then(function (oauth_res) {
        var response = oauth_res.responseText.toString();
        var response_object = JSON.parse(response);
        var oauth_url = response_object.locations[0].uri;

        var endpoint_url = oauth_url + ".well-known/openid-configuration";
        return httpReq("GET", endpoint_url);
    });

    // get an OAuth token
    return endpoint_res.then(function (endpoint_res) {
        var response = endpoint_res.responseText.toString();
        var response_object = JSON.parse(response);
        var token_url = response_object.token_endpoint;

        var token_body = new FormData();
        token_body.append("grant_type", "password");
        token_body.append("scope", "Innovator");
        token_body.append("client_id", "IOMApp");
        token_body.append("username", creds.user);
        token_body.append("password", creds.pwd);
        token_body.append("database", creds.db);

        return httpReq("POST", token_url, [], token_body);
    });
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
function uploadFile(file, file_id, transaction_id, creds, auth_headers, chunk_size = 10000) {
    var upload_url = creds.url + "/vault/odata/vault.UploadFile?fileId=" + file_id;
    var size = file.size;
    var attempts = 5;
    var start = 0;

    setTimeout(loop, 1);

    // we need to upload the file chunk(s) sequentially 
    function loop() {
        var end = start + chunk_size;
        if (size - end < 0) {
            end = size;
        }
        var chunk = file.slice(start, end);

        // get an array of headers for this upload request
        var headers = getUploadHeaders(auth_headers, escapeURL(file.name), start, end - 1, size, transaction_id);

        // make the request to upload this file content
        httpReq("POST", upload_url, headers, chunk, attempts);

        // if there is still content left to upload, update the start and loop again
        if (end < size - 1) {
            start += chunk_size;
            setTimeout(loop, 1);
        } 
    }
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
function commitTransaction(file, file_id, transaction_id, creds, auth_headers) {
    // build the headers and body for the commit request
    var boundary = "batch_" + file_id;
    var commit_headers = getCommitHeaders(boundary, transaction_id, auth_headers);
    
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
    return httpReq("POST", creds.url + "/vault/odata/vault.CommitTransaction", commit_headers, commit_body);
}


/**** header helpers *********************************************************/

/**
 * Returns an array of objects representing the headers required for an Innovator REST call using basic authentication (password rather than OAuth token).
 * Note that Aras Innovator 12.0 only supports OAuth. 
 * 
 * @param {*} creds - an object containing the connection data provided by the end user. See getConnectionInput for an example.
 */
function getBasicAuthHeaders(creds) {
    var basic_headers = [];
    basic_headers.push({
        name: "AUTHUSER",
        value: creds.user
    });
    basic_headers.push({
        name: "AUTHPASSWORD",
        value: creds.pwd
    });
    basic_headers.push({
        name: "DATABASE",
        value: creds.db
    });

    return basic_headers;
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
        return new Error("Please enter a Innovator url.");
    }
    if (!creds.db) {
        return new Error("Please enter a database name.");
    }
    if (!creds.user) {
        return new Error("Please enter a user name.");
    }
    if (!creds.pwd) {
        return new Error("Please enter a password.");
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
        return null;
    }

    return file;
}


/**** misc utilities *********************************************************/

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
