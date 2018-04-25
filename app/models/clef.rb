class Clef < ActiveRecord::Base
  # Dead code
  has_many :clefs_inclusions, inverse_of: :clef
  has_many :inclusions, through: :clefs_inclusions

  after_commit :clear_cache

  def note=(note_string)
    super(note_string.downcase)
  end

  def special?
    ["bc", "lut", "org"].include?(:note)
  end

  def self.clear_cache
    @cached_clefs = nil
  end

  def self.cached_clefs
    @cached_clefs ||= Clef.all.each_with_object({}) do |clef, hash|
      hash[clef.id] = clef
    end
  end

  private

  def clear_cache
    self.class.clear_cache
  end
end
