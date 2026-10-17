package runner;

import io.cucumber.testng.AbstractTestNGCucumberTests;
import io.cucumber.testng.CucumberOptions;

@CucumberOptions(features = "src/test/resources", glue = "stepdefinitions", plugin = { "pretty" })
public final class PaymentTestRunner extends AbstractTestNGCucumberTests { }
