/**
 * A helper function to send an HTTP call to the specified url.
 *
 * @param {*} type - HTTP call type. (GET or POST for this sample project)
 * @param {*} url - url to use for the HTTP call
 * @param {*} headers - an array of objects representing headers. Ex: [{name: "Content-Type", value: "application/json"}, {name: "AUTHUSER", value: "admin"}]
 * @param {*} body - body content of the HTTP call
 * @param {*} attempts - number of times we should attempt this call. Default value is 0.
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

        console.log(type + " : " + url);

        // add any headers passed to function
        headers = headers || [];
        for (var i = 0; i < headers.length; i++) {
            var header = headers[i];
            httpRequest.setRequestHeader(header.name, header.value);
        }
        
        // send the request
        httpRequest.send(body);

        // return httpRequest;

        // resolve or reject the promise when the response comes back
        httpRequest.onreadystatechange = function () {
            if (httpRequest.readyState == 4 && httpRequest.status == 200) {
                // resolve the promise and return the request object
                console.log("resolved : " + httpRequest.responseText.toString());
                resolve(httpRequest);

            } else if (httpRequest.readyState == 4 && attempts !== 0) {
                // we have more attempts left, retry
                console.log("retrying : " + httpRequest.responseText.toString());
                return httpReq(type, url, headers, body, attempts - 1);

            } else if (httpRequest.readyState == 4 && httpRequest.status == 400) {
                // reject the promise and return an error
                console.log("rejecting : " + httpRequest.responseText.toString());
                var err = new Error(httpRequest.statusText);
                reject(err);
            } 
        };
    });
}


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


/**
 * Returns an array of objects representing the headers required for an Innovator REST call using basic authentication (password rather than OAuth token).
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
 * 
 * @param {*} auth_headers 
 * @param {*} escaped_name 
 * @param {*} start_range 
 * @param {*} end_range 
 * @param {*} file_size 
 * @param {*} transaction_id 
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
 * 
 * @param {*} boundary 
 * @param {*} transaction_id 
 * @param {*} auth_headers 
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


/**
 * 
 * 
 * @param {*} boundary 
 * @param {*} creds 
 * @param {*} file_id 
 * @param {*} my_file 
 */
function getCommitBody(boundary, creds, file_id, my_file) {
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
    commit_body += '"filename":"' + my_file.name + '",';
    commit_body += '"file_size":' + my_file.size + ',';
    commit_body += '"Located":[{"file_version":1,"related_id":"67BBB9204FE84A8981ED8313049BA06C"}]}';
    commit_body += EOL;
    commit_body += "--" + boundary + "--";

    return commit_body;
}


/**
 * 
 * @param {*} server_url 
 */
function transactionUrl(server_url) {
    return server_url + "/vault/odata/vault.BeginTransaction";
}


/**
 * 
 * @param {*} server_url 
 * @param {*} file_id 
 */
function fileUploadUrl(server_url, file_id) {
    return server_url + "/vault/odata/vault.UploadFile?fileId=" + file_id;
}


/**
 * 
 * @param {*} server_url 
 */
function commitUrl(server_url) {
    return server_url + "/vault/odata/vault.CommitTransaction";
}


/**
 * 
 * @param {*} server_url 
 * @param {*} file_id 
 */
function getFileUrl(server_url, file_id) {
    return server_url + "/server/odata/file('" + file_id + "')";
}


/**
 * 
 * @param {*} transaction_response 
 */
function getTransactionIdFromResponse(transaction_response) {
    var response_object = JSON.parse(
        transaction_response.responseText.toString()
    );
    return response_object.transactionId;
}

function commitTransaction(my_file, file_id, transaction_id, creds, auth_headers) {
    var boundary = "batch_" + file_id;
    var commit_headers = getCommitHeaders(boundary, transaction_id, auth_headers);
    var commit_body = getCommitBody(boundary, creds, file_id, my_file);

    var commit = httpReq("POST", commitUrl(creds.url), commit_headers, commit_body);
    commit.then(function(commit_response) {
        var response = commit_response.responseText.toString();
        var response_json = response.substring(response.indexOf("{"), response.lastIndexOf("}") + 1);
        console.log(response_json);
        var response_object = JSON.parse(response_json);
        alert("Successfully uploaded file '" + response_object.filename + "' with id '" + response_object.id + "'" );
    });
}

function uploadFile(file, file_id, transaction_id, creds, auth_headers, chunk_size = 10000) {
    var upload_url = fileUploadUrl(creds.url, file_id);
    var size = file.size;
    var attempts = 5;
    var start = 0;

    setTimeout(loop, 1);

    function loop() {
        var end = start + chunk_size;
        if (size - end < 0) {
            end = size;
        }

        // var chunk = slice(file, start, end);
        var chunk = file.slice(start, end);

        // get an array of headers for this upload request
        var headers = getUploadHeaders(auth_headers, escapeURL(file.name), start, end - 1, size, transaction_id);

        httpReq("POST", upload_url, headers, chunk, attempts);

        if (end < size - 1) {
            start += chunk_size;
            setTimeout(loop, 1);
        } else {
            commitTransaction(file, file_id, transaction_id, creds, auth_headers);
        }
    }
}

/**
 * 
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

    // this sample project currently uses basic authentication (password), 
    // but it could be modified to use OAuth tokens instead
    var auth_headers = getBasicAuthHeaders(creds);

    var transaction_id = "";
    var file_id = generateNewGuid();
    console.log("file id: " + file_id);

    // get transactionid
    var transaction = httpReq("POST", transactionUrl(creds.url), auth_headers);
    transaction.then(function (transaction_req) {
        transaction_id = getTransactionIdFromResponse(transaction_req);
        return transaction_id;

    }).then(function () {
        // upload the file chunk(s)
        console.log("transaction id: " + transaction_id); 
        return uploadFile(my_file, file_id, transaction_id, creds, auth_headers);
        
    });
}


/**
 * 
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
 * escapes the following characters: %, ' ', ', !, ", #, $, &, (, ), *, +, ?
 * @param {*} url 
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
 * Formalize file.slice
 */

// function slice(file, start, end) {
//     var slice = file.mozSlice ? file.mozSlice :
//         file.webkitSlice ? file.webkitSlice :
//             file.slice ? file.slice : noop;

//     return slice.bind(file)(start, end);
// }