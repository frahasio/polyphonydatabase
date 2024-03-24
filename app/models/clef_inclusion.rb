class ClefInclusion < ApplicationRecord
  belongs_to :inclusion, inverse_of: :clef_inclusions

  scope :missing, -> { where(missing: true) }
  scope :incomplete, -> { where(incomplete: true) }
  scope :optional, -> { where(optional: true) }

  def sort_value
    return 1000 if new_record?

    CLEF_ORDER.index(clef).to_f +
      (missing? ? 0.1 : 0) +
      (incomplete? ? 0.1 : 0) +
      transitions_to.count * 0.01 +
      (optional? ? 0.5 : 0)
  end

  def special?
    ["bc", "lut", "org"].include?(:clef)
  end

  def display(source_context: true)
    annotated_clef = if source_context
      [clef, *transitions_to].compact_blank.join("/")
    else
      clef
    end

    annotated_clef = "(#{annotated_clef})" if optional?
    annotated_clef = "{#{annotated_clef}}" if source_context && incomplete?
    annotated_clef = "[#{annotated_clef}]" if source_context && missing?

    annotated_clef
  end

  def display=(annotated_clef)
    if annotated_clef =~ %r|^(\[)?({)?(\()?(\w+)/?((?:\w+/?)*)|
      self.clef = $4
      self.missing = $1.present?
      self.incomplete = $2.present?
      self.optional = $3.present?
      self.transitions_to = $5&.split("/")&.compact_blank
    end
  end

  private

  CLEF_ORDER = %w[
    g1
    g2
    g3
    c1
    g4
    c2
    g5
    c3
    f1
    g28
    c4
    f2
    c5
    d1
    f3
    d2
    f4
    d3
    y1
    f5
    d4
    y2
    d5
    y3
    y4
    y5
    x1
    x2
    x3
    x4
    x5
    org
    bc
    lut
  ].freeze
end
