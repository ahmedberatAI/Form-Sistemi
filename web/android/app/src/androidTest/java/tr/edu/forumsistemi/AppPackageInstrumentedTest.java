package tr.edu.forumsistemi;

import static org.junit.Assert.*;

import android.content.Context;
import androidx.test.ext.junit.runners.AndroidJUnit4;
import androidx.test.platform.app.InstrumentationRegistry;
import org.junit.Test;
import org.junit.runner.RunWith;

/**
 * Duman testi: hedef uygulama, build.gradle'daki namespace/applicationId ile aynı paket adıyla yüklenmiş olmalı.
 * (Capacitor şablonunun com.getcapacitor.app beklentisi bu projede geçerli değildir.)
 */
@RunWith(AndroidJUnit4.class)
public class AppPackageInstrumentedTest {

    @Test
    public void useAppContext() throws Exception {
        Context appContext = InstrumentationRegistry.getInstrumentation().getTargetContext();

        assertEquals("tr.edu.forumsistemi", appContext.getPackageName());
    }
}
