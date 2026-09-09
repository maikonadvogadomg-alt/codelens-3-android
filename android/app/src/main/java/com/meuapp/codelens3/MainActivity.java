package com.meuapp.codelens3;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;
import com.getcapacitor.community.database.sqlite.CapacitorSQLite;
public class MainActivity extends BridgeActivity {
    @Override public void onCreate(Bundle savedInstanceState) {
        registerPlugin(CapacitorSQLite.class);
        super.onCreate(savedInstanceState);
    }
}