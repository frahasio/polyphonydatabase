class Attribution < ActiveRecord::Base
  belongs_to :inclusion, inverse_of: :attributions
  belongs_to :alias, inverse_of: :attributions, optional: true
  belongs_to :composer, inverse_of: :attributions, optional: true
  belongs_to :anonym, inverse_of: :attributions, optional: true
  accepts_nested_attributes_for :anonym

  validate :has_some_attribution
  validate :incorrect_attribution

  belongs_to :refers_to, class_name: "Composer", foreign_key: "refers_to", optional: true, inverse_of: :attributions

  def self.unattributed
    where("composer_id is null").where("alias_id is null")
  end

  def self.for_unattributed_inclusions
    attributed_inclusion_ids = Attribution
      .distinct(:inclusion_id)
      .pluck(:inclusion_id)

    Inclusion.where.not(id: attributed_inclusion_ids).map do |inclusion|
      self.new(inclusion: inclusion)
    end
  end

  def resolved_composer
    composer || self.alias&.composer
  end

  def name
    composer&.name || anonym&.name || self.alias&.composer&.name
  end

  def anonym_name
    anonym&.name || self.alias&.anonym_name
  end

  def self.set_by_names(inclusion, names)
    names.each do |name|
      if inclusion.attributions.none? { |a| a.anonym_name == name }
        attrib = inclusion.attributions.build
        attrib.anonym = Anonym.find_or_create_by(name: name)
      end
    end

    return if inclusion.attributed_to.blank?

    inclusion.attributions.each do |attrib|
      if !names.include?(attrib.anonym_name)
        attrib.destroy
      end
    end
  end

  def status
    anonym ? "Unresolved" : "Resolved"
  end

private

  def has_some_attribution
    if composer.nil? && self.alias.nil? && anonym.nil?
      errors[:base] = "Must have a composer, alias, or anonym assigned"
    end
  end

  def incorrect_attribution
    errors[:base] = "Must be marked as incorrectly attributed if assigned directly to a composer" if composer unless incorrectly_attributed?
  end
end
