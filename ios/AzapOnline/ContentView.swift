//
//  ContentView.swift
//  AZAP Online
//
//  Tek ekran: tam ekran WKWebView. Arka plan oyunun kendi arka planı olduğu
//  için native tarafta ek UI yok — web'deki UI/UX birebir korunur.
//

import SwiftUI

struct ContentView: View {
    var body: some View {
        AzapWebView(url: URL(string: "https://azap.online/?platform=ios")!)
            .ignoresSafeArea()
            .background(Color.black)
            .statusBarHidden(false)
    }
}

#Preview {
    ContentView()
}
