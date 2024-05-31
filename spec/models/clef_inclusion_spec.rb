require "rails_helper"

RSpec.describe ClefInclusion do
  describe "#display(source_context: true)" do
    subject(:display) do
      described_class.new(clef:, missing:, incomplete:, optional:, transitions_to:)
        .display(source_context:)
    end

    let(:clef) { "c1" }
    let(:missing) { false }
    let(:incomplete) { false }
    let(:optional) { false }
    let(:transitions_to) { [] }

    let(:source_context) { true }

    it { is_expected.to eq("c1") }

    context "when optional" do
      let(:optional) { true }

      it { is_expected.to eq("(c1)") }

      context "when source_context: false" do
        let(:source_context) { false }

        it { is_expected.to eq("(c1)") }
      end
    end

    context "when missing" do
      let(:missing) { true }

      it { is_expected.to eq("[c1]") }

      context "when source_context: false" do
        let(:source_context) { false }

        it { is_expected.to eq("c1") }
      end
    end

    context "when incomplete" do
      let(:incomplete) { true }

      it { is_expected.to eq("{c1}") }

      context "when source_context: false" do
        let(:source_context) { false }

        it { is_expected.to eq("c1") }
      end
    end

    context "when transitional" do
      let(:transitions_to) { ["c2", "c3"] }

      it { is_expected.to eq("c1/c2/c3") }

      context "when source_context: false" do
        let(:source_context) { false }

        it { is_expected.to eq("c1") }
      end
    end

    context "when all of the above" do
      let(:optional) { true }
      let(:missing) { true }
      let(:incomplete) { true }
      let(:transitions_to) { ["c2", "c3"] }

      it { is_expected.to eq("[{(c1/c2/c3)}]") }

      context "when source_context: false" do
        let(:source_context) { false }

        it { is_expected.to eq("(c1)") }
      end
    end
  end

  describe "#display=(annoted_clef)" do
    subject(:ci) do
      described_class.new(display: annotated_clef)
    end

    let(:annotated_clef) { "c1" }

    it { is_expected.to have_attributes(clef: "c1", transitions_to: [])}
    it { is_expected.not_to be_optional }
    it { is_expected.not_to be_missing }
    it { is_expected.not_to be_incomplete }

    context "when optional" do
      let(:annotated_clef) { "(c1)" }

      it { is_expected.to be_optional }
    end

    context "when missing" do
      let(:annotated_clef) { "[c1]" }

      it { is_expected.to be_missing }
    end

    context "when incomplete" do
      let(:annotated_clef) { "{c1}" }

      it { is_expected.to be_incomplete }
    end

    context "when transitional" do
      let(:annotated_clef) { "c1/c2/c3" }

      it { is_expected.to have_attributes(transitions_to: ["c2", "c3"]) }
    end

    context "when all of the above" do
      let(:annotated_clef) { "[{(c1/c2/c3)}]" }

      it { is_expected.to be_optional }
      it { is_expected.to be_missing }
      it { is_expected.to be_incomplete }
      it { is_expected.to have_attributes(transitions_to: ["c2", "c3"]) }
    end
  end

  describe "#sort_value" do
    it "returns the index of the clef in the CLEF_ORDER" do
      ci = create(:clef_inclusion, clef: "c1")
      expect(ci.sort_value).to eq(3.0)
    end

    it "adds 0.1 if missing" do
      ci = create(:clef_inclusion, clef: "c1", missing: true)
      expect(ci.sort_value).to eq(3.1)
    end

    it "adds 0.1 if incomplete" do
      ci = create(:clef_inclusion, clef: "c1", incomplete: true)
      expect(ci.sort_value).to eq(3.1)
    end

    it "adds 0.01 for each transition" do
      ci = create(:clef_inclusion, clef: "c1", transitions_to: ["c2", "c3"])
      expect(ci.sort_value).to eq(3.02)
    end

    it "adds 0.5 if optional" do
      ci = create(:clef_inclusion, clef: "c1", optional: true)
      expect(ci.sort_value).to eq(3.5)
    end

    it "returns a sum of all of applicable adjustments" do
      ci = create(:clef_inclusion, clef: "c1", missing: true, incomplete: true, transitions_to: ["c2", "c3"], optional: true)
      expect(ci.sort_value).to eq(3.72)
    end

    it "returns 1000 if new_record?" do
      ci = described_class.new
      expect(ci.sort_value).to eq(1000)
    end
  end
end
