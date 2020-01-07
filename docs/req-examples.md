`req` usage examples
====================

Note: you'll get pretty colors in your terminal.  TODO: show pretty colors on this page.

Basic
-----
The HTTP method is optional and defaults to `GET` if there is no request body, or `POST` if there is.

```
$ req https://netsleuth.io/example.json
GET /example.json HTTP/1.1
User-Agent: netsleuth/1.0.0 (req; +https://netsleuth.io)
Host: netsleuth.io

HTTP/1.1 200 OK
Cache-Control: public, max-age=31536000
ETag: ns001
Content-Type: application/json; charset=utf-8
Content-Length: 17
Date: Tue, 07 Jan 2020 00:31:15 GMT

{ hello: 'world' }

$ req https://netsleuth.io/example.json foo=bar
POST /example.json HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Content-Length: 13
Content-Type: application/json
Host: netsleuth.io

{ foo: 'bar' }

HTTP/1.1 202 Accepted
Content-Type: text/plain; charset=utf-8
Content-Length: 8
ETag: W/"8-YaBXLEiT7zQxEyDYTILfiL6oPhE"
Date: Tue, 07 Jan 2020 00:33:03 GMT

Accepted

$ req PUT https://netsleuth.io/example.json @test.json
PUT /example.json HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Content-Length: 17
Content-Type: application/json
Host: netsleuth.io

[uploading file... 17 bytes]

HTTP/1.1 202 Accepted
Content-Type: text/plain; charset=utf-8
Content-Length: 8
ETag: W/"8-YaBXLEiT7zQxEyDYTILfiL6oPhE"
Date: Tue, 07 Jan 2020 00:40:34 GMT

Accepted
```

localhost
---------
```
$ req :5000/ok
GET /ok HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Host: 127.0.0.1:5000

HTTP/1.1 200 OK
ETag: ns001
Content-Type: text/plain; charset=utf-8
Content-Length: 2
Date: Tue, 07 Jan 2020 00:43:28 GMT

ok
```

Headers
-------
```
$ req :5000/ok If-None-Match:ns001
GET /ok HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
If-None-Match: ns001
Host: 127.0.0.1:5000

HTTP/1.1 304 Not Modified
ETag: ns001
Date: Tue, 07 Jan 2020 00:53:00 GMT
```

Note that `req` does not have a cache; this example simply shows the use of conditional request headers.

Profiles
--------
```
$ req profile add test http://user:pass@127.0.0.1:5000 Cache-Control:no-cache
Profile created.

$ req test/ok
GET /ok HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Cache-Control: no-cache
Host: 127.0.0.1:5000
Authorization: Basic dXNlcjpwYXNz

HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Content-Length: 2
ETag: ns001
Date: Tue, 07 Jan 2020 00:50:12 GMT

ok

$ req profile edit test Cache-Control:   # empty value to remove header from profile
Profile updated.
```

After logging in to your test site using your browser, raid the cookie jar:

```
$ req profile add test2 http://127.0.0.1:5000 -C
Profile created.

$ req test2/ok
GET /ok HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Cookie: user=t0k3n
Host: 127.0.0.1:5000

HTTP/1.1 200 OK
ETag: ns001
Content-Type: text/html; charset=utf-8
Content-Length: 2
Date: Tue, 07 Jan 2020 01:17:25 GMT

ok

$ req profile rm test2
Profile deleted.
```

### Payloads

You can store named payloads on a profile and use the <code>+</code> operator to send them with a request.

```
$ req profile payload test u1 token=u1t0k3n
Profile payload updated.

$ req test/post +u1
POST /post HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Content-Length: 19
Content-Type: application/json
Host: 127.0.0.1:5000
Authorization: Basic dXNlcjpwYXNz

{ token: 'u1t0k3n' }

HTTP/1.1 200 OK
Content-Type: text/plain; charset=utf-8
Content-Length: 12
Date: Tue, 07 Jan 2020 01:35:39 GMT

got 19 bytes
```

Diff
----
You can save a request/response to a HAR file and then compare differences with a later request.
```
$ req https://netsleuth.io/rand.json --har luck.har
GET /rand.json HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Host: netsleuth.io

HTTP/1.1 200 OK
Cache-Control: no-cache
Content-Type: application/json; charset=utf-8
Content-Length: 36
Date: Tue, 07 Jan 2020 01:45:23 GMT

{ info: 'your lucky number', n: 146 }

$ req https://netsleuth.io/rand.json --diff luck.har
GET /rand.json HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Host: netsleuth.io

HTTP/1.1 200 OK
Cache-Control: no-cache
Content-Type: application/json; charset=utf-8
Content-Length: 36
                35
Date: Tue, 07 Jan 2020 01:45:23 GMT
      Tue, 07 Jan 2020 01:46:00 GMT

{
  info: "your lucky number"
  n: 146 => 38
}
```

Or compare at once:

```
$ req https://netsleuth.io/rand.json --har | req https://netsleuth.io/rand.json --diff
GET /rand.json HTTP/1.1
User-Agent: netsleuth/0.0.23 (req; +https://netsleuth.io)
Host: netsleuth.io

HTTP/1.1 200 OK
Cache-Control: no-cache
Content-Type: application/json; charset=utf-8
Content-Length: 34
                35
Date: Tue, 07 Jan 2020 01:47:21 GMT

{
  info: "your lucky number"
  n: 8 => 98
}
```
