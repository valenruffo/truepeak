import { NextRequest, NextResponse } from "next/server";

export async function GET(request: NextRequest) {
  const BACKEND_URL = process.env.NEXT_PUBLIC_API_URL || "http://164.152.194.196:8000";
  
  try {
    const start = Date.now();
    const res = await fetch(`${BACKEND_URL}/api/health`, { 
      signal: AbortSignal.timeout(5000) 
    });
    const duration = Date.now() - start;
    
    if (res.ok) {
      const data = await res.json();
      return NextResponse.json({ 
        status: "success", 
        backend: BACKEND_URL, 
        duration: `${duration}ms`,
        data 
      });
    } else {
      return NextResponse.json({ 
        status: "error", 
        backend: BACKEND_URL, 
        httpStatus: res.status,
        text: await res.text()
      }, { status: 502 });
    }
  } catch (err: any) {
    return NextResponse.json({ 
      status: "exception", 
      backend: BACKEND_URL, 
      error: err.message 
    }, { status: 500 });
  }
}
